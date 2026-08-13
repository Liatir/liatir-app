/**
 * The scientific viewers, exposed as pipeline steps.
 *
 * A viewer is a tool like any other here: it takes a file as input and produces a result. That is
 * what lets visualisation be a *node in a pipeline* — align reads, call variants, then render the
 * tracks — rather than something the user has to do by hand afterwards.
 *
 * These steps do not draw anything themselves. They validate the input and emit a viewer *section* in
 * the tool output; the actual rendering happens when a user opens the Result. Optional heavy viewer
 * runtimes are loaded on demand, while the bounded single-cell preview stays built in. That separation
 * keeps a pipeline run headless and fast while still producing something interactive at the end.
 */
import { liatir } from '$lib/api';
import type { PipelineStepDefinition, RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import {
  LIATIR_ANNDATA_PROFILE_V1,
  type JsonValue,
  type LiatirArtifactRequirement,
  type LiatirScientificArtifactMetadata,
} from '@liatir/core';
import { dataFiles } from '$lib/stores/dataFiles.svelte';
import { assertArtifactCompatible, inspectAnnDataArtifact } from '$lib/scientific-artifacts';

/** 3D molecular structures. `accept` lists the formats 3Dmol.js can actually read. */
export const structureViewerDefinition: PipelineStepDefinition = {
  id: 'viewer-structure-3d',
  type: 'utility',
  label: '3D Structure Viewer',
  description: 'Render a protein or molecule structure artifact with the installed 3D structure viewer runtime.',
  category: 'Visualization',
  inputSchema: {
    structureFile: {
      type: 'file',
      label: 'Structure file',
      required: true,
      accept: ['pdb', 'cif', 'mmcif', 'sdf', 'mol2', 'xyz'],
    },
    style: {
      type: 'string',
      label: 'Style',
      required: false,
      default: 'cartoon',
      options: [
        { value: 'cartoon', label: 'Cartoon' },
        { value: 'stick', label: 'Stick' },
        { value: 'line', label: 'Line' },
        { value: 'sphere', label: 'Sphere' },
      ],
    },
  },
  outputSchema: {
    report: { type: 'json', label: 'Viewer report' },
  },
};

export const genomeViewerDefinition: PipelineStepDefinition = {
  id: 'viewer-genome-track',
  type: 'utility',
  label: 'Genome Track Viewer',
  description: 'Create an inspectable genome-track viewer section for FASTA/GFF/BED/VCF artifacts.',
  category: 'Visualization',
  inputSchema: {
    referenceFile: {
      type: 'file',
      label: 'Reference FASTA',
      required: false,
      accept: ['fasta', 'fa', 'fna'],
    },
    trackFile: {
      type: 'file',
      label: 'Track file',
      required: true,
      accept: ['gff', 'gff3', 'bed', 'vcf', 'vcf.gz', 'bam'],
    },
    refName: {
      type: 'string',
      label: 'Reference name',
      required: false,
      default: '',
    },
  },
  outputSchema: {
    report: { type: 'json', label: 'Viewer report' },
  },
};

export const singleCellViewerAnnDataRequirement: LiatirArtifactRequirement = {
  profiles: [{ ...LIATIR_ANNDATA_PROFILE_V1 }],
  formats: ['anndata-h5ad'],
  scientificTypes: ['annotated-matrix'],
  validation: 'valid-or-partial',
  qualifiers: {
    modalities: ['single-cell-rna'],
  },
};

export const singleCellViewerDefinition: PipelineStepDefinition = {
  id: 'viewer-single-cell',
  type: 'utility',
  label: 'Single-cell Viewer',
  description: 'Inspect a profiled AnnData artifact and an optional bounded embedding preview CSV.',
  category: 'Visualization',
  inputSchema: {
    inputFile: {
      type: 'file',
      label: 'AnnData artifact',
      required: true,
      accept: ['h5ad'],
      artifact: singleCellViewerAnnDataRequirement,
    },
    previewFile: {
      type: 'file',
      label: 'Embedding preview',
      description: 'Optional CSV emitted with an embedded AnnData artifact. Connect it to render the first two embedding dimensions.',
      required: false,
      accept: ['csv'],
    },
    embeddingKey: {
      type: 'string',
      label: 'Embedding key',
      description: 'Optional AnnData obsm key, for example X_geneformer.',
      required: false,
      default: '',
    },
  },
  outputSchema: {
    report: { type: 'json', label: 'Viewer report' },
  },
};

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function extension(path: string): string {
  const name = basename(path).toLowerCase();
  if (name.endsWith('.vcf.gz')) return 'vcf';
  const ext = name.split('.').pop() ?? '';
  if (ext === 'gff3') return 'gff';
  if (ext === 'mmcif') return 'mmcif';
  return ext;
}

/** Defaults to PDB: it is the most common structure format, and 3Dmol.js parses it most reliably. */
function structureFormat(path: string): 'pdb' | 'cif' | 'mmcif' | 'sdf' | 'mol2' | 'xyz' {
  const ext = extension(path);
  if (ext === 'mmcif') return 'mmcif';
  if (ext === 'cif') return 'cif';
  if (ext === 'sdf') return 'sdf';
  if (ext === 'mol2') return 'mol2';
  if (ext === 'xyz') return 'xyz';
  return 'pdb';
}

/** `unknown` is deliberate here: a track of an unrecognised type is *not* silently guessed at. */
function genomeTrackKind(path: string): 'gff' | 'bed' | 'vcf' | 'bam' | 'unknown' {
  const ext = extension(path);
  if (ext === 'gff') return 'gff';
  if (ext === 'bed') return 'bed';
  if (ext === 'vcf') return 'vcf';
  if (ext === 'bam') return 'bam';
  return 'unknown';
}

/**
 * Splits a CSV line, respecting quoted fields.
 *
 * `line.split(',')` would be wrong: cell-type labels routinely contain commas ("T cell, CD4+"), and
 * splitting naively would shear one label into two and corrupt every count downstream. Tracking the
 * quote state is what prevents that.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map(cell => cell.trim().replace(/^"|"$/g, ''));
}

export interface SingleCellEmbeddingPreviewPoint {
  cellId: string;
  x: number;
  y: number;
}

function previewProjectionFromCsv(text: string): 'bounded-preview-pca' | 'first-two-dimensions' {
  const headers = splitCsvLine(text.split(/\r?\n/, 1)[0] ?? '');
  return headers.includes('preview_pc_1') && headers.includes('preview_pc_2')
    ? 'bounded-preview-pca'
    : 'first-two-dimensions';
}

/** Parse the bounded CSV preview emitted by every Single-cell Embedding AI Model. */
export function embeddingPointsFromCsv(
  text: string,
  limit = 5_000,
): SingleCellEmbeddingPreviewPoint[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const dimensions = headers
    .map((header, index) => ({ header, index }))
    .filter(item => /^preview_pc_[12]$/i.test(item.header) || /^dim_\d+$/i.test(item.header))
    .sort((a, b) => {
      const aPca = /^preview_pc_[12]$/i.test(a.header);
      const bPca = /^preview_pc_[12]$/i.test(b.header);
      if (aPca !== bPca) return aPca ? -1 : 1;
      const number = (header: string) => Number(header.match(/\d+$/)?.[0] ?? 0);
      return number(a.header) - number(b.header);
    });
  if (dimensions.length === 0) return [];
  const xIndex = dimensions[0].index;
  const yIndex = dimensions[1]?.index;
  const cellIdIndex = headers.findIndex(header => /^(cell_?id|cell|observation)$/i.test(header));
  const points: SingleCellEmbeddingPreviewPoint[] = [];
  for (const line of lines.slice(1, Math.max(1, limit) + 1)) {
    const cells = splitCsvLine(line);
    const rawX = cells[xIndex]?.trim();
    const rawY = yIndex === undefined ? undefined : cells[yIndex]?.trim();
    if (!rawX || (yIndex !== undefined && !rawY)) continue;
    const x = Number(rawX);
    const y = yIndex === undefined ? 0 : Number(rawY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({
      cellId: (cellIdIndex >= 0 ? cells[cellIdIndex] : '') || `cell_${points.length + 1}`,
      x,
      y,
    });
  }
  return points;
}

/**
 * Emits a structure-viewer section. Produces no files — the viewer *is* the output, rendered when the
 * user opens the Result (see the note at the top of this file).
 */
export async function runStructureViewerStep(
  inputs: Record<string, string>,
  _outputDir: string,
  onLog: (line: string) => void,
): Promise<{ outputFiles: RunOutputFile[]; output: ToolOutput; values: Record<string, JsonValue> }> {
  if (!inputs.structureFile) throw new Error('Structure file is required.');
  const format = structureFormat(inputs.structureFile);
  const style = (inputs.style || 'cartoon') as 'cartoon' | 'stick' | 'line' | 'sphere';
  onLog(`viewer ${structureViewerDefinition.id}`);
  onLog(`structure ${basename(inputs.structureFile)}`);

  return {
    outputFiles: [],
    output: {
      sections: [
        {
          type: 'structure-viewer',
          label: basename(inputs.structureFile),
          description: 'Requires the 3Dmol.js viewer runtime from Dependencies.',
          path: inputs.structureFile,
          format,
          style,
          colorScheme: 'spectrum',
          height: 460,
        },
      ],
    },
    values: {
      report: {
        viewer: 'structure-viewer',
        file: basename(inputs.structureFile),
        format,
      },
    },
  };
}

export async function runGenomeViewerStep(
  inputs: Record<string, string>,
  _outputDir: string,
  onLog: (line: string) => void,
): Promise<{ outputFiles: RunOutputFile[]; output: ToolOutput; values: Record<string, JsonValue> }> {
  if (!inputs.trackFile) throw new Error('Track file is required.');
  const trackKind = genomeTrackKind(inputs.trackFile);
  onLog(`viewer ${genomeViewerDefinition.id}`);
  onLog(`track ${basename(inputs.trackFile)}`);

  return {
    outputFiles: [],
    output: {
      sections: [
        {
          type: 'genome-viewer',
          label: basename(inputs.trackFile),
          description: 'Lightweight local preview. Full JBrowse 2 rendering is a modular viewer runtime.',
          assembly: {
            name: inputs.referenceFile ? basename(inputs.referenceFile) : 'local assembly',
            fastaPath: inputs.referenceFile || undefined,
            refName: inputs.refName || undefined,
          },
          tracks: [
            {
              name: basename(inputs.trackFile),
              kind: trackKind,
              path: inputs.trackFile,
            },
          ],
          height: 340,
        },
      ],
    },
    values: {
      report: {
        viewer: 'genome-viewer',
        track: basename(inputs.trackFile),
        trackKind,
      },
    },
  };
}

export async function runSingleCellViewerStep(
  inputs: Record<string, string>,
  _outputDir: string,
  onLog: (line: string) => void,
): Promise<{ outputFiles: RunOutputFile[]; output: ToolOutput; values: Record<string, JsonValue> }> {
  if (!inputs.inputFile) throw new Error('Single-cell artifact is required.');
  const api = liatir();
  const ext = extension(inputs.inputFile);
  if (ext !== 'h5ad') {
    throw new Error('Single-cell Viewer requires a profiled AnnData .h5ad artifact. Add a separate embedding preview CSV when available.');
  }
  let embeddingPoints: SingleCellEmbeddingPreviewPoint[] = [];
  let scientific: LiatirScientificArtifactMetadata | undefined;
  let previewPath = inputs.previewFile || '';
  let projection = 'first-two-dimensions';

  await dataFiles.init();
  scientific = await dataFiles.ensureAnnDataProfile(inputs.inputFile, true);
  if (!scientific) scientific = await inspectAnnDataArtifact(inputs.inputFile);
  const compatibility = assertArtifactCompatible(scientific, singleCellViewerAnnDataRequirement);
  for (const item of compatibility.diagnostics.filter(diagnostic => diagnostic.severity === 'warning')) {
    onLog(`artifact warning: ${item.message}${item.action ? ` ${item.action}` : ''}`);
  }
  if (!previewPath && typeof scientific.viewerHints?.embeddingPreviewPath === 'string') {
    previewPath = scientific.viewerHints.embeddingPreviewPath;
  }

  if (api && previewPath) {
    try {
      const previewText = await api.invoke('lia_read_file_text', { path: previewPath }) as string;
      embeddingPoints = embeddingPointsFromCsv(previewText);
      projection = previewProjectionFromCsv(previewText);
    } catch (error) {
      if (inputs.previewFile) throw new Error('The selected embedding preview CSV could not be read.');
      onLog(`viewer warning: stored embedding preview is unavailable (${error instanceof Error ? error.message : String(error)})`);
      previewPath = '';
    }
  }

  const embeddingKey = inputs.embeddingKey
    || (typeof scientific?.viewerHints?.embeddingKey === 'string' ? scientific.viewerHints.embeddingKey : '')
    || scientific?.qualifiers.embeddingKeys?.[0]
    || '';
  const matrix = scientific?.qualifiers.matrix;
  if (!previewPath && typeof scientific?.viewerHints?.projection === 'string') {
    projection = scientific.viewerHints.projection;
  }

  onLog(`viewer ${singleCellViewerDefinition.id}`);
  onLog(`artifact ${basename(inputs.inputFile)}`);
  if (embeddingPoints.length > 0) onLog(`preview ${embeddingPoints.length} cells`);

  return {
    outputFiles: [],
    output: {
      sections: [
        {
          type: 'single-cell-viewer',
          label: basename(inputs.inputFile),
          description: 'Validated AnnData with a bounded embedding preview; the full matrix remains in the artifact.',
          config: {
            title: basename(inputs.inputFile),
            source: inputs.inputFile,
            ...(previewPath ? { previewCsv: previewPath } : {}),
            labelCounts: {},
            embeddingPoints: embeddingPoints as unknown as JsonValue,
            projection,
            ...(embeddingKey ? { embeddingKey } : {}),
            ...(matrix?.observations !== undefined ? { cellCount: matrix.observations } : {}),
            ...(scientific?.qualifiers.embeddingKeys?.length
              ? { availableEmbeddingKeys: scientific.qualifiers.embeddingKeys }
              : {}),
            ...(scientific
              ? {
                  artifactId: scientific.physical.artifactId,
                  validationStatus: scientific.validation.status,
                }
              : {}),
          },
          height: 340,
        },
      ],
    },
    values: {
      report: {
        viewer: 'single-cell-viewer',
        artifact: basename(inputs.inputFile),
        labelCount: 0,
        previewPointCount: embeddingPoints.length,
        projection,
        embeddingKey: embeddingKey || null,
        artifactId: scientific?.physical.artifactId ?? null,
        validationStatus: scientific?.validation.status ?? null,
      },
    },
  };
}
