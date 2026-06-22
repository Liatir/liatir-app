import type { ToolOutput, StatsSection, TextSection } from '$lib/types/tool-output';
import type { PipelineStepDefinition } from '$lib/types/pipeline';

export const samtoolsFlagstatDefinition: PipelineStepDefinition = {
  id: 'samtools-flagstat',
  type: 'native-tool',
  label: 'Samtools flagstat',
  description: 'Alignment statistics for BAM/SAM/CRAM files.',
  category: 'Alignment',
  inputSchema: {
    inputFile: { type: 'file', label: 'BAM / SAM / CRAM', required: true, accept: ['bam', 'sam', 'cram'] },
  },
  outputSchema: {
    stats: { type: 'stats', label: 'Alignment statistics' },
  },
};

export interface FlagstatResult {
  total: number;
  mapped: number;
  mappedPct: number | null;
  duplicates: number;
  duplicatesPct: number | null;
  properlyPaired: number;
  properlyPairedPct: number | null;
  singletons: number;
  singletonsPct: number | null;
  secondary: number;
  supplementary: number;
}

function extractNum(line: string): number {
  const m = line.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function extractPct(line: string): number | null {
  const m = line.match(/\((\d+\.?\d*)%/);
  return m ? parseFloat(m[1]) : null;
}

export function parseFlagstatResult(stdout: string): FlagstatResult {
  const lines = stdout.split('\n').filter(l => l.trim());
  const find = (key: string) => lines.find(l => l.includes(key)) ?? '';

  return {
    total: extractNum(find('in total')),
    mapped: extractNum(find('mapped (')),
    mappedPct: extractPct(find('mapped (')),
    duplicates: extractNum(find('duplicates')),
    duplicatesPct: extractPct(find('duplicates')),
    properlyPaired: extractNum(find('properly paired')),
    properlyPairedPct: extractPct(find('properly paired')),
    singletons: extractNum(find('singletons')),
    singletonsPct: extractPct(find('singletons')),
    secondary: extractNum(find('secondary')),
    supplementary: extractNum(find('supplementary')),
  };
}

function pctColor(pct: number | null): string {
  if (pct === null) return '#71717a';
  if (pct >= 90) return '#10b981';
  if (pct >= 70) return '#f59e0b';
  return '#ef4444';
}

export function flagstatToToolOutput(r: FlagstatResult, rawStdout: string): ToolOutput {
  const mappedColor = pctColor(r.mappedPct);
  const dupColor = r.duplicatesPct !== null
    ? (r.duplicatesPct <= 5 ? '#10b981' : r.duplicatesPct <= 20 ? '#f59e0b' : '#ef4444')
    : '#71717a';
  const ppColor = pctColor(r.properlyPairedPct);

  const statsSection: StatsSection = {
    type: 'stats',
    cols: 4,
    items: [
      {
        label: 'Total Reads',
        value: r.total.toLocaleString(),
        description: 'Total reads (QC-passed + QC-failed).',
      },
      {
        label: 'Mapped',
        value: r.mappedPct !== null ? `${r.mappedPct.toFixed(1)}%` : r.mapped.toLocaleString(),
        color: mappedColor,
        description: 'Reads that aligned to the reference genome.',
      },
      {
        label: 'Duplicates',
        value: r.duplicatesPct !== null ? `${r.duplicatesPct.toFixed(1)}%` : r.duplicates.toLocaleString(),
        color: dupColor,
        description: 'PCR or optical duplicates. Lower is better.',
      },
      {
        label: 'Properly Paired',
        value: r.properlyPairedPct !== null ? `${r.properlyPairedPct.toFixed(1)}%` : r.properlyPaired.toLocaleString(),
        color: ppColor,
        description: 'Both mates mapped in expected orientation and distance.',
      },
    ],
  };

  const rawSection: TextSection = {
    type: 'text',
    label: 'Raw flagstat output',
    content: rawStdout,
    mono: true,
    raw: true,
  };

  return { sections: [statsSection, rawSection] };
}
