/**
 * The scientific viewers, exposed as pipeline steps.
 *
 * A viewer is a tool like any other here: it takes a file as input and produces a result. That is
 * what lets visualisation be a *node in a pipeline* — align reads, call variants, then render the
 * tracks — rather than something the user has to do by hand afterwards.
 *
 * These steps do not draw anything themselves. They validate the input and emit a viewer *section* in
 * the tool output; the actual rendering happens when a user opens the Result, at which point the
 * heavy viewer runtime is loaded on demand. That separation is what keeps a pipeline run headless and
 * fast while still producing something interactive at the end.
 */
import { liatir } from '$lib/api';
import type { PipelineStepDefinition, RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import type { JsonValue } from '@liatir/core';

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

export const singleCellViewerDefinition: PipelineStepDefinition = {
  id: 'viewer-single-cell',
  type: 'utility',
  label: 'Single-cell Viewer',
  description: 'Create a single-cell/spatial viewer section from AnnData, label CSV, or summary JSON artifacts.',
  category: 'Visualization',
  inputSchema: {
    inputFile: {
      type: 'file',
      label: 'Single-cell artifact',
      required: true,
      accept: ['h5ad', 'csv', 'json'],
    },
    labelColumn: {
      type: 'string',
      label: 'Label column',
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

/**
 * Counts how many cells carry each label, for the summary shown beside a single-cell view.
 *
 * Finding the label column is the interesting part. An explicit column wins; failing that, the header
 * is matched against the names annotation tools actually emit (`predicted_labels`, `majority_voting`,
 * `cell_type`, …), because there is no standard and every tool names it differently. Falling back to
 * column 0 means a file with an unrecognised header still produces *something* rather than nothing.
 */
function labelCountsFromCsv(text: string, preferredColumn: string): Record<string, number> {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  // A header alone, with no rows, has nothing to count.
  if (lines.length < 2) return {};
  const headers = splitCsvLine(lines[0]);
  const preferredIndex = preferredColumn ? headers.indexOf(preferredColumn) : -1;
  const labelIndex = preferredIndex >= 0
    ? preferredIndex
    // Math.max(..., 0) turns findIndex's -1 (no match) into column 0.
    : Math.max(
        headers.findIndex(header => /majority|predicted|label|cell_type|annotation/i.test(header)),
        0,
      );
  const counts: Record<string, number> = {};
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    // An empty cell is counted as `unlabeled` rather than dropped: the total must still equal the
    // number of cells, or the summary would quietly misrepresent the dataset.
    const label = cells[labelIndex] || 'unlabeled';
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

/** Some tools pre-compute the counts. Both shapes seen in the wild are accepted. */
function labelCountsFromJson(text: string): Record<string, number> {
  const parsed = JSON.parse(text) as {
    counts?: Record<string, number>;
    summary?: { counts?: Record<string, number> };
  };
  return parsed.counts ?? parsed.summary?.counts ?? {};
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
  let labelCounts: Record<string, number> = {};

  if (api && (ext === 'csv' || ext === 'json')) {
    const text = await api.invoke('lia_read_file_text', { path: inputs.inputFile }) as string;
    labelCounts = ext === 'json'
      ? labelCountsFromJson(text)
      : labelCountsFromCsv(text, inputs.labelColumn || '');
  }

  onLog(`viewer ${singleCellViewerDefinition.id}`);
  onLog(`artifact ${basename(inputs.inputFile)}`);

  return {
    outputFiles: [],
    output: {
      sections: [
        {
          type: 'single-cell-viewer',
          label: basename(inputs.inputFile),
          description: 'Lightweight label distribution preview. Full Vitessce rendering is a modular viewer runtime.',
          config: {
            title: basename(inputs.inputFile),
            source: inputs.inputFile,
            labelCounts,
          },
          height: 340,
        },
      ],
    },
    values: {
      report: {
        viewer: 'single-cell-viewer',
        artifact: basename(inputs.inputFile),
        labelCount: Object.keys(labelCounts).length,
      },
    },
  };
}
