import type { ToolOutput, StatsSection, TextSection } from '$lib/types/tool-output';
import type { PipelineStepDefinition } from '$lib/types/pipeline';

export const bwaMemDefinition: PipelineStepDefinition = {
  id: 'bwa-mem',
  type: 'native-tool',
  label: 'BWA-MEM',
  description: 'Map short reads to a reference genome. Outputs SAM format.',
  category: 'Alignment',
  inputSchema: {
    reference: { type: 'file', label: 'Reference FASTA', required: true, accept: ['fa', 'fasta', 'fa.gz', 'fasta.gz'] },
    readsR1: { type: 'file', label: 'Reads R1 (FASTQ)', required: true, accept: ['fastq', 'fastq.gz', 'fq', 'fq.gz'] },
    readsR2: { type: 'file', label: 'Reads R2 (paired-end, optional)', required: false, accept: ['fastq', 'fastq.gz', 'fq', 'fq.gz'] },
  },
  outputSchema: {
    outputSam: { type: 'file', label: 'Output SAM', ext: ['sam'] },
  },
};

export interface BwaMemStats {
  logLines: number;
  warnings: number;
  duration: string | null;
}

export function parseBwaMemStats(stderr: string[]): BwaMemStats {
  let warnings = 0;
  let duration: string | null = null;

  for (const line of stderr) {
    if (line.includes('[W::')) warnings++;
    const m = line.match(/Real time:\s+([\d.]+)\s+sec/);
    if (m) duration = `${parseFloat(m[1]).toFixed(1)}s`;
  }

  return { logLines: stderr.length, warnings, duration };
}

export function bwaMemToToolOutput(stats: BwaMemStats, stderrRaw: string, outputPath: string): ToolOutput {
  const fileName = outputPath.split(/[\\/]/).pop() ?? outputPath;

  const statsSection: StatsSection = {
    type: 'stats',
    cols: 3,
    items: [
      { label: 'Output file', value: fileName, description: 'SAM file written to disk.' },
      ...(stats.duration ? [{ label: 'Wall time', value: stats.duration, description: 'Real elapsed time.' }] : []),
      {
        label: 'Warnings',
        value: stats.warnings === 0 ? 'None' : String(stats.warnings),
        color: stats.warnings > 0 ? '#f59e0b' : '#10b981',
        description: '[W::] lines from bwa stderr.',
      },
    ],
  };

  const rawSection: TextSection = {
    type: 'text',
    label: 'bwa stderr',
    content: stderrRaw,
    mono: true,
    raw: true,
  };

  return { sections: [statsSection, rawSection] };
}
