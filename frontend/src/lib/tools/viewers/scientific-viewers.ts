import { liatir } from '$lib/api';
import type { PipelineStepDefinition, RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import type { JsonValue } from '@liatir/core';

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

function structureFormat(path: string): 'pdb' | 'cif' | 'mmcif' | 'sdf' | 'mol2' | 'xyz' {
  const ext = extension(path);
  if (ext === 'mmcif') return 'mmcif';
  if (ext === 'cif') return 'cif';
  if (ext === 'sdf') return 'sdf';
  if (ext === 'mol2') return 'mol2';
  if (ext === 'xyz') return 'xyz';
  return 'pdb';
}

function genomeTrackKind(path: string): 'gff' | 'bed' | 'vcf' | 'bam' | 'unknown' {
  const ext = extension(path);
  if (ext === 'gff') return 'gff';
  if (ext === 'bed') return 'bed';
  if (ext === 'vcf') return 'vcf';
  if (ext === 'bam') return 'bam';
  return 'unknown';
}

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

function labelCountsFromCsv(text: string, preferredColumn: string): Record<string, number> {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return {};
  const headers = splitCsvLine(lines[0]);
  const preferredIndex = preferredColumn ? headers.indexOf(preferredColumn) : -1;
  const labelIndex = preferredIndex >= 0
    ? preferredIndex
    : Math.max(
        headers.findIndex(header => /majority|predicted|label|cell_type|annotation/i.test(header)),
        0,
      );
  const counts: Record<string, number> = {};
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const label = cells[labelIndex] || 'unlabeled';
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

function labelCountsFromJson(text: string): Record<string, number> {
  const parsed = JSON.parse(text) as {
    counts?: Record<string, number>;
    summary?: { counts?: Record<string, number> };
  };
  return parsed.counts ?? parsed.summary?.counts ?? {};
}

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
