// Single-cell RNA-seq, in two steps.
//
// `simpleaf` drives the whole chain — it builds the reference index with `piscem`, maps the
// reads with it, and runs `alevin-fry` for permit list, collation and UMI resolution. Liatir
// calls simpleaf rather than the three engines directly for the reason a product does: one
// command that fails once, instead of five that can each fail differently.
//
// Building an index and quantifying a sample are separate steps because they have separate
// lifetimes. An index is built once for a species and reused by every sample; a
// quantification is per sample. Fusing them would rebuild a 30-minute index for every run.

import {
  LIATIR_ANNDATA_PROFILE_V1,
  LIATIR_SINGLE_CELL_INDEX_EXTENSION,
  LIATIR_SINGLE_CELL_INDEX_KIND,
  liatirSingleCellCountsAreWhole,
  liatirSingleCellFeatureNamespace,
  parseLiatirSingleCellIndexManifest,
  type LiatirSingleCellIndexManifest,
} from '@liatir/core';
import {
  alevinFryToToolOutput,
  parseAlevinFryGeneIds,
  parseAlevinFryPermitList,
  parseAlevinFryQuant,
  parseSimpleafMapInfo,
} from '@liatir/output-parser';
import { liatir } from '$lib/api';
import type { AIRunContext } from '$lib/ai/direct-run-context';
import { aiRunMetadata } from '$lib/ai/direct-run-context';
import { moveRunFile } from '$lib/execution/run-storage';
import { inspectAnnDataArtifact } from '$lib/scientific-artifacts';
import type { PipelineStepDefinition, RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { runNativeTool, type NativeRunOptions } from '$lib/utils/native-tool';
import { threadInputSchema, threadParam } from '$lib/utils/execution-resources';

const FASTA = ['fa', 'fasta', 'fna', 'fa.gz', 'fasta.gz', 'fna.gz'];
const ANNOTATION = ['gtf', 'gtf.gz', 'gff3', 'gff3.gz', 'gff', 'gff.gz'];
const FASTQ = ['fastq', 'fastq.gz', 'fq', 'fq.gz'];

/** Chemistries simpleaf resolves without reaching for the network. */
export const singleCellChemistryOptions = [
  { value: '10xv3', label: '10x Genomics 3′ v3', description: 'Chromium Single Cell 3′ v3 and v3.1.' },
  { value: '10xv4-3p', label: '10x Genomics 3′ v4', description: 'Chromium GEM-X Single Cell 3′ v4.' },
  { value: '10xv2', label: '10x Genomics 3′ v2', description: 'Chromium Single Cell 3′ v2.' },
  { value: '10xv3-5p', label: '10x Genomics 5′ v3', description: 'Chromium Single Cell 5′ v3.' },
  { value: '10xv2-5p', label: '10x Genomics 5′ v2', description: 'Chromium Single Cell 5′ v2.' },
];

/** UMI resolution modes, in the order a user should consider them. */
export const singleCellResolutionOptions = [
  { value: 'cr-like', label: 'Standard (CellRanger-like)', description: 'Whole counts. Matches what most published analyses use.' },
  { value: 'cr-like-em', label: 'Standard, shared reads (EM)', description: 'Splits ambiguous reads between genes, so counts can be fractional.' },
  { value: 'parsimony', label: 'Parsimony', description: 'Whole counts, resolved with the smallest set of transcripts that explains the reads.' },
  { value: 'parsimony-em', label: 'Parsimony, shared reads (EM)', description: 'Parsimony with fractional counts.' },
  { value: 'parsimony-gene', label: 'Parsimony (gene level)', description: 'Whole counts, collapsed to genes before resolution.' },
  { value: 'parsimony-gene-em', label: 'Parsimony (gene level), shared reads (EM)', description: 'Gene-level parsimony with fractional counts.' },
];

export const singleCellCellFilterOptions = [
  { value: 'knee', label: 'Detect cells automatically', description: 'Liatir finds the drop between real cells and empty droplets. Needs nothing from you.' },
  { value: 'explicit', label: 'Use my barcode list', description: 'Quantify exactly the cell barcodes in a file you supply, one per line.' },
  { value: 'forced', label: 'Keep a fixed number of cells', description: 'Take the N barcodes with the most reads.' },
];

// ── Step definitions ─────────────────────────────────────────────────────────

export const simpleafIndexDefinition: PipelineStepDefinition = {
  id: 'simpleaf-index',
  type: 'native-tool',
  label: 'Single-cell Reference Index',
  description:
    'Build the reference a single-cell experiment is quantified against, from a genome and its annotation. Build it once per species and annotation release, then reuse it for every sample.',
  category: 'Single-cell',
  inputSchema: {
    genomeFasta: {
      type: 'file',
      label: 'Genome FASTA',
      required: true,
      accept: FASTA,
      description: 'The species genome, as downloaded from Ensembl or GENCODE.',
    },
    annotation: {
      type: 'file',
      label: 'Annotation (GTF or GFF3)',
      required: true,
      accept: ANNOTATION,
      description:
        'Where the genes are in that genome. It must be the annotation release that goes with the genome — results from two releases are not comparable.',
    },
    readLength: {
      type: 'number',
      label: 'Read length',
      required: false,
      default: 91,
      connectable: false,
      description:
        'Length of the biological read (R2) in the samples this index will be used for. 91 suits 10x 3′ v3.',
    },
    threads: threadInputSchema('Worker threads for index construction. 0 lets Liatir choose a safe local value.'),
  },
  outputSchema: {
    index: {
      type: 'file',
      label: 'Single-cell index',
      ext: [LIATIR_SINGLE_CELL_INDEX_EXTENSION],
      description: 'Connect this to a Single-cell Quantification step.',
    },
    stats: { type: 'stats', label: 'Index summary' },
  },
};

export const simpleafQuantDefinition: PipelineStepDefinition = {
  id: 'simpleaf-quant',
  type: 'native-tool',
  label: 'Single-cell Quantification',
  description:
    'Turn raw single-cell reads into a count matrix: how many times each gene was seen in each cell. Writes an AnnData .h5ad file, which is what the single-cell AI Tools read.',
  category: 'Single-cell',
  inputSchema: {
    index: {
      type: 'file',
      label: 'Single-cell index',
      required: true,
      accept: [LIATIR_SINGLE_CELL_INDEX_EXTENSION],
      description: 'The index produced by a Single-cell Reference Index step.',
    },
    readsR1: {
      type: 'file',
      label: 'Reads R1 (barcodes and UMIs)',
      required: true,
      accept: FASTQ,
      description: 'The short read that carries the cell barcode and the UMI.',
    },
    readsR2: {
      type: 'file',
      label: 'Reads R2 (cDNA)',
      required: true,
      accept: FASTQ,
      description: 'The read that carries the actual transcript sequence.',
    },
    chemistry: {
      type: 'string',
      label: 'Chemistry',
      required: true,
      default: '10xv3',
      options: singleCellChemistryOptions,
      description: 'The kit the library was made with. Getting this wrong makes almost nothing map.',
    },
    cellFilter: {
      type: 'string',
      label: 'Which droplets are cells',
      required: true,
      default: 'knee',
      options: singleCellCellFilterOptions,
      connectable: false,
    },
    permitList: {
      type: 'file',
      label: 'Cell barcode list',
      required: false,
      accept: ['txt', 'tsv', 'csv'],
      description: 'Only used with "Use my barcode list". One barcode per line.',
    },
    forcedCells: {
      type: 'number',
      label: 'Number of cells',
      required: false,
      connectable: false,
      description: 'Only used with "Keep a fixed number of cells".',
    },
    resolution: {
      type: 'string',
      label: 'UMI resolution',
      required: true,
      default: 'cr-like',
      options: singleCellResolutionOptions,
      connectable: false,
      description: 'How a read that could belong to more than one gene is counted.',
    },
    threads: threadInputSchema('Worker threads for mapping and quantification. 0 lets Liatir choose a safe local value.'),
  },
  outputSchema: {
    matrix: {
      type: 'file',
      label: 'Count matrix (AnnData)',
      ext: ['h5ad'],
      description:
        'Genes are named by the identifiers in your annotation — Ensembl IDs for an Ensembl or GENCODE release. Gene symbols are kept alongside them when the annotation carried any.',
      artifact: {
        profile: { ...LIATIR_ANNDATA_PROFILE_V1 },
        format: 'anndata-h5ad',
        scientificType: 'annotated-matrix',
        qualifiers: {
          modality: 'single-cell-rna',
          preprocessing: ['raw-counts'],
          representations: ['expression'],
        },
      },
    },
    stats: { type: 'stats', label: 'Quantification summary' },
    cells: { type: 'number', label: 'Cells', format: 'integer' },
    genes: { type: 'number', label: 'Genes', format: 'integer' },
    percentMapped: { type: 'number', label: 'Reads mapped %', format: 'percent' },
  },
};

// ── Shared helpers ───────────────────────────────────────────────────────────

export interface SingleCellStepResult {
  outputFiles: RunOutputFile[];
  output?: ToolOutput;
  metrics?: Record<string, number>;
}

/**
 * Whatever owns the run, supplying the job options each `simpleaf` call is spawned with.
 *
 * A tool page and a pipeline step run exactly the same code; what differs is only the run
 * they belong to — its identity, its cancellation, where its logs are recorded. A standalone
 * run from a tool page satisfies this directly (`beginDirectNativeToolRun`), so neither the
 * index nor the quantification exists twice.
 */
export interface SingleCellRunHost {
  nativeOptions(overrides?: NativeRunOptions): NativeRunOptions;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** A file name without the extensions that describe how it was packaged. */
function sampleName(path: string): string {
  const name = basename(path).replace(/\.(gz|bz2|zst)$/i, '');
  const stem = name.replace(/\.[^.]+$/, '') || name;
  // Trim the read-number suffix Illumina adds, so a sample is not called "sample_R1".
  return stem.replace(/[._-](R?[12])(_001)?$/i, '') || stem;
}

function isGff3(path: string): boolean {
  return /\.gff3?(\.gz)?$/i.test(path);
}

function pipelineHost(context?: AIRunContext): SingleCellRunHost {
  const base: NativeRunOptions = !context || context.runKind !== 'pipeline-step'
    ? {}
    : {
        label: context.label,
        kind: 'pipeline-step',
        metadata: aiRunMetadata(context),
        signal: context.signal,
        onSpawn: context.onJobId,
      };
  return { nativeOptions: (overrides = {}) => ({ ...base, ...overrides }) };
}

async function readText(path: string): Promise<string> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  return await api.invoke('lia_read_file_text', { path }) as string;
}

async function writeText(path: string, content: string): Promise<void> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  await api.invoke('lia_write_file_path', { path, content });
}

async function fileSize(path: string): Promise<number | undefined> {
  const api = liatir();
  if (!api) return undefined;
  try {
    return await api.invoke('lia_file_size', { path }) as number;
  } catch {
    return undefined;
  }
}

async function requireFile(path: string, what: string): Promise<number> {
  const size = await fileSize(path);
  if (size === undefined) {
    throw new Error(`${what} is missing — simpleaf reported success but did not write ${basename(path)}.`);
  }
  return size;
}

async function runSimpleaf(
  args: string[],
  onLog: (line: string) => void,
  host: SingleCellRunHost,
  label: string,
): Promise<void> {
  const result = await runNativeTool(
    'simpleaf',
    args,
    (line) => { if (line.trim()) onLog(line); },
    (line) => { if (line.trim()) onLog(line); },
    host.nativeOptions({ label }),
  );
  if (!result.ok) {
    // simpleaf reports the failing engine on stderr; the last line is the actionable one.
    const reason = result.stderr.split(/\r?\n/).filter(Boolean).pop();
    throw new Error(reason || `simpleaf exited with code ${result.exitCode}`);
  }
}

// ── Index ────────────────────────────────────────────────────────────────────

export function runSimpleafIndexStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  context?: AIRunContext,
): Promise<SingleCellStepResult> {
  return runSimpleafIndex(inputs, outputDir, onLog, pipelineHost(context));
}

export async function runSimpleafIndex(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  host: SingleCellRunHost,
): Promise<SingleCellStepResult> {
  const { threads } = threadParam(inputs.threads);
  const readLength = Number(inputs.readLength) > 0 ? Math.trunc(Number(inputs.readLength)) : 91;
  const root = `${outputDir}/index`;
  const gff3 = isGff3(inputs.annotation);

  onLog(`Building a single-cell reference from ${basename(inputs.genomeFasta)} and ${basename(inputs.annotation)}.`);
  onLog('This reads every chromosome and is the slow half of single-cell — but it is done once.');
  await runSimpleaf(
    [
      'index',
      '--output', root,
      '--fasta', inputs.genomeFasta,
      '--gtf', inputs.annotation,
      '--rlen', String(readLength),
      '--threads', String(threads),
      // Left to itself piscem writes its scratch directory into whatever the process's working
      // directory happens to be. Naming it keeps the run's temporary files inside the run.
      '--work-dir', `${root}/build-scratch`,
      ...(gff3 ? ['--gff3-format'] : []),
    ],
    onLog,
    host,
    'Single-cell reference index',
  );

  const indexDir = `${root}/index`;
  const t2gMap = `${indexDir}/t2g_3col.tsv`;
  await requireFile(t2gMap, 'The transcript-to-gene map');
  const geneIdToName = `${indexDir}/gene_id_to_name.tsv`;
  const hasGeneNames = (await fileSize(geneIdToName)) !== undefined;

  const manifest: LiatirSingleCellIndexManifest = {
    schemaVersion: 1,
    kind: LIATIR_SINGLE_CELL_INDEX_KIND,
    indexDir,
    t2gMap,
    ...(hasGeneNames ? { geneIdToName } : {}),
    referenceType: 'spliced+intronic',
    readLength,
    sources: {
      genomeFasta: inputs.genomeFasta,
      annotation: inputs.annotation,
      annotationFormat: gff3 ? 'gff3' : 'gtf',
    },
    createdAt: new Date().toISOString(),
  };
  const manifestPath = `${outputDir}/${sampleName(inputs.genomeFasta)}.${LIATIR_SINGLE_CELL_INDEX_EXTENSION}`;
  await writeText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestSize = await requireFile(manifestPath, 'The index description');

  return {
    outputFiles: [
      {
        label: 'Single-cell index',
        path: manifestPath,
        ext: LIATIR_SINGLE_CELL_INDEX_EXTENSION,
        size: manifestSize,
        fieldKey: 'index',
      },
    ],
    output: {
      sections: [
        {
          type: 'stats',
          cols: 3,
          items: [
            { label: 'Reference', value: 'spliced + intronic', description: 'Reads from unprocessed transcripts are counted too, not thrown away.' },
            { label: 'Read length', value: String(readLength), description: 'Intronic sequence was padded for reads of this length.' },
            { label: 'Gene symbols', value: hasGeneNames ? 'yes' : 'no', description: hasGeneNames ? 'The annotation carried gene names, so the matrix will have them.' : 'The annotation carried no gene names; the matrix will have gene IDs only.' },
          ],
        },
        {
          type: 'table',
          label: 'Built from',
          headers: ['Input', 'File'],
          rows: [
            ['Genome', basename(inputs.genomeFasta)],
            ['Annotation', basename(inputs.annotation)],
          ],
        },
      ],
    },
  };
}

// ── Quantification ───────────────────────────────────────────────────────────

/** The permit-list flag for the chosen way of deciding which droplets held a cell. */
function cellFilterArguments(inputs: Record<string, string>): string[] {
  switch (inputs.cellFilter || 'knee') {
    case 'explicit': {
      if (!inputs.permitList) {
        throw new Error('Choose a cell barcode list, or switch to detecting cells automatically.');
      }
      return ['--explicit-pl', inputs.permitList];
    }
    case 'forced': {
      const cells = Math.trunc(Number(inputs.forcedCells));
      if (!Number.isFinite(cells) || cells <= 0) {
        throw new Error('Enter how many cells to keep, or switch to detecting cells automatically.');
      }
      return ['--forced-cells', String(cells)];
    }
    default:
      return ['--knee'];
  }
}

export function runSimpleafQuantStep(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  context?: AIRunContext,
): Promise<SingleCellStepResult> {
  return runSimpleafQuant(inputs, outputDir, onLog, pipelineHost(context));
}

export async function runSimpleafQuant(
  inputs: Record<string, string>,
  outputDir: string,
  onLog: (line: string) => void,
  host: SingleCellRunHost,
): Promise<SingleCellStepResult> {
  const manifest = parseLiatirSingleCellIndexManifest(await readText(inputs.index));
  const { threads } = threadParam(inputs.threads);
  const resolution = inputs.resolution || 'cr-like';
  const quantRoot = `${outputDir}/quant`;
  const filter = cellFilterArguments(inputs);

  onLog(`Mapping ${basename(inputs.readsR1)} against the index and counting UMIs per cell.`);
  await runSimpleaf(
    [
      'quant',
      '--index', manifest.indexDir,
      '--t2g-map', manifest.t2gMap,
      '--reads1', inputs.readsR1,
      '--reads2', inputs.readsR2,
      '--chemistry', inputs.chemistry || '10xv3',
      '--resolution', resolution,
      ...filter,
      '--output', quantRoot,
      '--threads', String(threads),
      // simpleaf writes the AnnData file itself, from the same matrix it wrote to disk. No
      // second implementation of the format exists in Liatir, and none should.
      '--anndata-out',
    ],
    onLog,
    host,
    'Single-cell quantification',
  );

  const alevin = `${quantRoot}/af_quant/alevin`;
  const quant = parseAlevinFryQuant(await readText(`${quantRoot}/af_quant/quant.json`));
  if (quant.cells === 0) {
    throw new Error(
      'No cells were found. Check that the chemistry matches the kit the library was made with, and that R1 and R2 are the right way round.',
    );
  }
  const mapping = parseSimpleafMapInfo(await readText(`${quantRoot}/af_map/map_info.json`));
  const permit = parseAlevinFryPermitList(await readText(`${quantRoot}/af_quant/generate_permit_list.json`));

  const produced = `${alevin}/quants.h5ad`;
  await requireFile(produced, 'The count matrix');
  const matrixPath = `${outputDir}/${sampleName(inputs.readsR1)}.h5ad`;
  await moveRunFile(produced, matrixPath);
  const matrixSize = await requireFile(matrixPath, 'The count matrix');

  const geneIds = parseAlevinFryGeneIds(
    await readText(`${alevin}/quants_mat_cols.txt`),
    quant.usaMode,
  );
  const featureNamespace = liatirSingleCellFeatureNamespace(geneIds);
  const wholeCounts = liatirSingleCellCountsAreWhole(resolution);

  const scientific = await inspectAnnDataArtifact(
    matrixPath,
    {
      observations: quant.cells,
      variables: quant.genes,
      matrixLocation: 'X',
      matrixPresent: true,
      // UMI counts: a count is a finite, non-negative number by construction, and a whole one
      // unless the resolution mode shared reads between genes. Stated from the algorithm that
      // produced them rather than by re-reading a matrix that can be hundreds of megabytes.
      finiteValues: true,
      nonNegativeValues: true,
      integerLikeValues: wholeCounts,
      sparse: true,
      scientificType: 'annotated-matrix',
      modality: 'single-cell-rna',
      ...(featureNamespace ? { featureNamespace } : {}),
      preprocessing: wholeCounts ? ['raw-counts'] : ['expected-counts'],
      representations: ['expression'],
    },
    {
      lineage: {
        sources: [{ artifactId: inputs.readsR1, role: 'input', fieldKey: 'readsR1' }],
        transformation: {
          id: simpleafQuantDefinition.id,
          label: simpleafQuantDefinition.label,
          version: quant.version,
          parameters: {
            chemistry: inputs.chemistry || '10xv3',
            resolution,
            cellFilter: inputs.cellFilter || 'knee',
            referenceType: manifest.referenceType,
            index: manifest.indexDir,
          },
        },
      },
      viewerHints: { preferredViewer: 'single-cell' },
    },
  );

  if (!wholeCounts) {
    onLog(
      'This resolution shares ambiguous reads between genes, so counts are fractional. Tools that require raw counts will refuse this matrix.',
    );
  }
  if (quant.usaMode) {
    onLog(
      'Counts include reads from introns as well as exons (spliced + unspliced + ambiguous). The three are also kept separately, as layers inside the file.',
    );
  }

  return {
    outputFiles: [
      {
        label: 'Count matrix (AnnData)',
        path: matrixPath,
        ext: 'h5ad',
        size: matrixSize,
        fieldKey: 'matrix',
        mediaType: 'application/x-hdf5',
        scientific,
      },
    ],
    output: alevinFryToToolOutput({
      mapping,
      permit,
      quant,
      matrixFileName: basename(matrixPath),
    }) as ToolOutput,
    metrics: {
      cells: quant.cells,
      genes: quant.genes,
      percentMapped: mapping.percentMapped,
    },
  };
}
