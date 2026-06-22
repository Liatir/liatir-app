import type { ToolOutput, StatsSection, TextSection } from '$lib/types/tool-output';
import type { PipelineStepDefinition } from '$lib/types/pipeline';

export const MINIMAP2_PRESETS = [
  { value: 'sr',      label: 'Short reads (Illumina)',    description: 'Paired-end short reads, optimized for Illumina.' },
  { value: 'map-ont', label: 'ONT reads',                 description: 'Oxford Nanopore long reads.' },
  { value: 'map-pb',  label: 'PacBio CLR',                description: 'PacBio continuous long reads.' },
  { value: 'map-hifi',label: 'PacBio HiFi',               description: 'PacBio CCS / HiFi high-accuracy reads.' },
  { value: 'asm5',    label: 'Assembly (asm5)',            description: 'Sequence divergence ≤5% — genome assembly alignment.' },
  { value: 'asm20',   label: 'Assembly (asm20)',           description: 'Sequence divergence ≤20%.' },
] as const;

export type Minimap2Preset = typeof MINIMAP2_PRESETS[number]['value'];

export const minimap2Definition: PipelineStepDefinition = {
  id: 'minimap2',
  type: 'native-tool',
  label: 'Minimap2',
  description: 'Versatile alignment for long and short reads. Outputs SAM format.',
  category: 'Alignment',
  inputSchema: {
    reference: { type: 'file', label: 'Reference FASTA', required: true, accept: ['fa', 'fasta', 'fa.gz', 'fasta.gz', 'mmi'] },
    reads:     { type: 'file', label: 'Reads (FASTQ/FASTA)', required: true, accept: ['fastq', 'fastq.gz', 'fq', 'fq.gz', 'fa', 'fasta'] },
  },
  outputSchema: {
    outputSam: { type: 'file', label: 'Output SAM', ext: ['sam'] },
  },
};

export interface Minimap2Stats {
  totalReads: number | null;
  duration: string | null;
}

export function parseMinimap2Stats(stderr: string[]): Minimap2Stats {
  let totalReads: number | null = null;
  let duration: string | null = null;

  for (const line of stderr) {
    const processedMatch = line.match(/Processed\s+(\d+)\s+reads/);
    if (processedMatch) {
      totalReads = (totalReads ?? 0) + parseInt(processedMatch[1], 10);
    }
    const durationMatch = line.match(/Real time:\s+([\d.]+)\s+sec/);
    if (durationMatch) duration = `${parseFloat(durationMatch[1]).toFixed(1)}s`;
  }

  return { totalReads, duration };
}

export function minimap2ToToolOutput(stats: Minimap2Stats, stderrRaw: string, outputPath: string, preset: string): ToolOutput {
  const fileName = outputPath.split(/[\\/]/).pop() ?? outputPath;
  const presetLabel = MINIMAP2_PRESETS.find(p => p.value === preset)?.label ?? preset;

  const statsItems = [
    { label: 'Output file', value: fileName, description: 'SAM file written to disk.' },
    { label: 'Preset', value: presetLabel, description: 'Alignment mode used.' },
  ];
  if (stats.totalReads !== null) {
    statsItems.push({ label: 'Reads processed', value: stats.totalReads.toLocaleString(), description: 'Total reads aligned.' });
  }
  if (stats.duration) {
    statsItems.push({ label: 'Wall time', value: stats.duration, description: 'Real elapsed time.' });
  }

  const statsSection: StatsSection = {
    type: 'stats',
    cols: 4,
    items: statsItems,
  };

  const rawSection: TextSection = {
    type: 'text',
    label: 'minimap2 stderr',
    content: stderrRaw,
    mono: true,
    raw: true,
  };

  return { sections: [statsSection, rawSection] };
}
