import type { ToolOutput, StatsSection, TextSection } from '$lib/types/tool-output';
import type { PipelineStepDefinition } from '$lib/types/pipeline';

export const seqkitStatsDefinition: PipelineStepDefinition = {
  id: 'seqkit-stats',
  type: 'native-tool',
  label: 'seqkit stats',
  description: 'Sequence statistics for FASTA and FASTQ files.',
  category: 'Quality Control',
  inputSchema: {
    inputFile: {
      type: 'file',
      label: 'FASTA / FASTQ file',
      required: true,
      accept: ['fasta', 'fa', 'fna', 'fastq', 'fq', 'fastq.gz', 'fq.gz', 'fasta.gz', 'fa.gz'],
    },
  },
  outputSchema: {
    stats: { type: 'stats', label: 'Sequence statistics' },
  },
};

export interface SeqkitStatsResult {
  file: string;
  format: string;
  type: string;
  numSeqs: number;
  sumLen: number;
  minLen: number;
  avgLen: number;
  maxLen: number;
  // extended (seqkit stats -a)
  q1: number | null;
  q2: number | null;
  q3: number | null;
  n50: number | null;
  q20Pct: number | null;
  q30Pct: number | null;
  gcPct: number | null;
}

function col(parts: string[], idx: number): string {
  return (parts[idx] ?? '').replace(/,/g, '').trim();
}

function num(parts: string[], idx: number): number {
  return parseFloat(col(parts, idx)) || 0;
}

function numOrNull(parts: string[], idx: number): number | null {
  const v = parseFloat(col(parts, idx));
  return isNaN(v) ? null : v;
}

export function parseSeqkitStats(stdout: string): SeqkitStatsResult | null {
  const lines = stdout.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  if (lines.length < 2) return null;

  // First non-empty line is header, second is data
  const headerLine = lines[0];
  const dataLine = lines[1];
  if (!dataLine) return null;

  const headers = headerLine.trim().split(/\s+/);
  const parts = dataLine.trim().split(/\s+/);

  const idx = (name: string) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

  const iFile    = 0;
  const iFormat  = idx('format');
  const iType    = idx('type');
  const iNum     = idx('num_seqs');
  const iSum     = idx('sum_len');
  const iMin     = idx('min_len');
  const iAvg     = idx('avg_len');
  const iMax     = idx('max_len');
  const iQ1      = idx('Q1');
  const iQ2      = idx('Q2');
  const iQ3      = idx('Q3');
  const iN50     = idx('N50');
  const iQ20     = headers.findIndex(h => h.startsWith('Q20'));
  const iQ30     = headers.findIndex(h => h.startsWith('Q30'));
  const iGC      = headers.findIndex(h => h.toLowerCase().startsWith('gc'));

  return {
    file:    col(parts, iFile),
    format:  iFormat >= 0 ? col(parts, iFormat) : '',
    type:    iType   >= 0 ? col(parts, iType)   : '',
    numSeqs: num(parts, iNum),
    sumLen:  num(parts, iSum),
    minLen:  num(parts, iMin),
    avgLen:  num(parts, iAvg),
    maxLen:  num(parts, iMax),
    q1:      iQ1  >= 0 ? numOrNull(parts, iQ1)  : null,
    q2:      iQ2  >= 0 ? numOrNull(parts, iQ2)  : null,
    q3:      iQ3  >= 0 ? numOrNull(parts, iQ3)  : null,
    n50:     iN50 >= 0 ? numOrNull(parts, iN50) : null,
    q20Pct:  iQ20 >= 0 ? numOrNull(parts, iQ20) : null,
    q30Pct:  iQ30 >= 0 ? numOrNull(parts, iQ30) : null,
    gcPct:   iGC  >= 0 ? numOrNull(parts, iGC)  : null,
  };
}

function fmtLen(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} Gb`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)} Mb`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)} Kb`;
  return `${n} bp`;
}

export function seqkitStatsToToolOutput(r: SeqkitStatsResult, rawStdout: string): ToolOutput {
  const items: StatsSection['items'] = [
    {
      label: 'Sequences',
      value: r.numSeqs.toLocaleString(),
      description: `${r.format} · ${r.type}`,
    },
    {
      label: 'Total length',
      value: fmtLen(r.sumLen),
      description: `${r.sumLen.toLocaleString()} bp`,
    },
    {
      label: 'Min length',
      value: fmtLen(r.minLen),
      description: 'Shortest sequence',
    },
    {
      label: 'Avg length',
      value: fmtLen(r.avgLen),
      description: 'Mean sequence length',
    },
    {
      label: 'Max length',
      value: fmtLen(r.maxLen),
      description: 'Longest sequence',
    },
  ];

  if (r.n50 !== null) {
    items.push({
      label: 'N50',
      value: fmtLen(r.n50),
      description: 'Half of total assembly length is in sequences ≥ N50',
    });
  }
  if (r.gcPct !== null) {
    items.push({
      label: 'GC content',
      value: `${r.gcPct.toFixed(1)}%`,
      description: 'Guanine + Cytosine fraction',
    });
  }
  if (r.q30Pct !== null) {
    const color = r.q30Pct >= 80 ? '#10b981' : r.q30Pct >= 60 ? '#f59e0b' : '#ef4444';
    items.push({
      label: 'Q30 rate',
      value: `${r.q30Pct.toFixed(1)}%`,
      color,
      description: 'Fraction of bases with Phred quality ≥ 30',
    });
  }
  if (r.q20Pct !== null) {
    items.push({
      label: 'Q20 rate',
      value: `${r.q20Pct.toFixed(1)}%`,
      description: 'Fraction of bases with Phred quality ≥ 20',
    });
  }

  const stats: StatsSection = { type: 'stats', cols: 4, items };

  const raw: TextSection = {
    type: 'text',
    label: 'Raw seqkit output',
    content: rawStdout,
    mono: true,
    raw: true,
  };

  return { sections: [stats, raw] };
}
