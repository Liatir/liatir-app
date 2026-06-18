import type { ToolOutput, StatsSection, TextSection } from '$lib/types/tool-output';
import type { PipelineStepDefinition } from '$lib/types/pipeline';

export const bcftoolsStatsDefinition: PipelineStepDefinition = {
  id: 'bcftools-stats',
  type: 'native-tool',
  label: 'BCFtools stats',
  description: 'Variant statistics for VCF/BCF files.',
  category: 'Variant Calling',
  inputSchema: {
    inputFile: { type: 'file', label: 'VCF / BCF file', required: true, accept: ['vcf', 'vcf.gz', 'bcf', 'bcf.gz'] },
  },
  outputSchema: {
    stats: { type: 'stats', label: 'Variant statistics' },
  },
};

export interface BcftoolsStatsResult {
  samples: number;
  records: number;
  snps: number;
  mnps: number;
  indels: number;
  multiallelic: number;
  multiallelicSnps: number;
  transitions: number;
  transversions: number;
  tstv: number | null;
}

function snValue(lines: string[], key: string): number {
  const line = lines.find(l => l.startsWith('SN') && l.includes(key));
  if (!line) return 0;
  const parts = line.split('\t');
  return parseInt(parts[3] ?? '0', 10);
}

export function parseBcftoolsStats(stdout: string): BcftoolsStatsResult {
  const lines = stdout.split('\n');

  const tstvLine = lines.find(l => l.startsWith('TSTV\t'));
  let ts = 0, tv = 0, tstv: number | null = null;
  if (tstvLine) {
    const p = tstvLine.split('\t');
    ts   = parseInt(p[2] ?? '0', 10);
    tv   = parseInt(p[3] ?? '0', 10);
    tstv = parseFloat(p[4] ?? '0') || null;
  }

  return {
    samples:         snValue(lines, 'number of samples'),
    records:         snValue(lines, 'number of records'),
    snps:            snValue(lines, 'number of SNPs'),
    mnps:            snValue(lines, 'number of MNPs'),
    indels:          snValue(lines, 'number of indels'),
    multiallelic:    snValue(lines, 'number of multiallelic sites'),
    multiallelicSnps:snValue(lines, 'number of multiallelic SNP sites'),
    transitions: ts,
    transversions: tv,
    tstv,
  };
}

function tstvColor(r: number | null): string {
  if (r === null) return '#71717a';
  // Expected Ts/Tv for whole genome ~2.0–2.1, exome ~2.8–3.0
  if (r >= 1.8) return '#10b981';
  if (r >= 1.5) return '#f59e0b';
  return '#ef4444';
}

export function bcftoolsStatsToToolOutput(r: BcftoolsStatsResult, rawStdout: string): ToolOutput {
  const stats: StatsSection = {
    type: 'stats',
    cols: 4,
    items: [
      {
        label: 'Total Records',
        value: r.records.toLocaleString(),
        description: 'Total variant records in the file.',
      },
      {
        label: 'SNPs',
        value: r.snps.toLocaleString(),
        color: '#6366f1',
        description: 'Single nucleotide polymorphisms.',
      },
      {
        label: 'Indels',
        value: r.indels.toLocaleString(),
        color: '#8b5cf6',
        description: 'Insertions and deletions.',
      },
      {
        label: 'Ts/Tv Ratio',
        value: r.tstv !== null ? r.tstv.toFixed(3) : 'N/A',
        color: tstvColor(r.tstv),
        description: 'Transition/transversion ratio. Expected ≥1.8 (WGS ~2.0, exome ~2.8).',
      },
      {
        label: 'Transitions',
        value: r.transitions.toLocaleString(),
        description: 'Purine↔purine or pyrimidine↔pyrimidine substitutions.',
      },
      {
        label: 'Transversions',
        value: r.transversions.toLocaleString(),
        description: 'Purine↔pyrimidine substitutions.',
      },
      {
        label: 'Multiallelic',
        value: r.multiallelic.toLocaleString(),
        description: 'Sites with more than one alternate allele.',
      },
      {
        label: 'Samples',
        value: r.samples.toLocaleString(),
        description: 'Number of samples in the file.',
      },
    ],
  };

  const raw: TextSection = {
    type: 'text',
    label: 'Raw bcftools stats output',
    content: rawStdout,
    mono: true,
  };

  return { sections: [stats, raw] };
}
