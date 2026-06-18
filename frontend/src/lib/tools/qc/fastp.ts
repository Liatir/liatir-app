import type { ToolOutput, StatsSection, TextSection } from '$lib/types/tool-output';
import type { PipelineStepDefinition } from '$lib/types/pipeline';

export const fastpDefinition: PipelineStepDefinition = {
  id: 'fastp',
  type: 'native-tool',
  label: 'fastp',
  description: 'FASTQ quality trimming, adapter removal, and QC reporting.',
  category: 'Quality Control',
  inputSchema: {
    r1: { type: 'file', label: 'R1 FASTQ', required: true, accept: ['fastq', 'fastq.gz', 'fq', 'fq.gz'] },
    r2: { type: 'file', label: 'R2 FASTQ (optional, paired-end)', required: false, accept: ['fastq', 'fastq.gz', 'fq', 'fq.gz'] },
  },
  outputSchema: {
    trimmedR1:  { type: 'file', label: 'Trimmed R1', ext: ['fastq.gz'] },
    trimmedR2:  { type: 'file', label: 'Trimmed R2', ext: ['fastq.gz'], description: 'Only produced in paired-end mode.' },
    stats:      { type: 'stats', label: 'QC statistics' },
  },
};

export interface FastpSummary {
  before: {
    totalReads: number;
    totalBases: number;
    q20Rate: number;
    q30Rate: number;
    gcContent: number;
  };
  after: {
    totalReads: number;
    totalBases: number;
    q20Rate: number;
    q30Rate: number;
    gcContent: number;
  };
  filtering: {
    passed: number;
    lowQuality: number;
    tooManyN: number;
    tooShort: number;
    tooLong: number;
  };
}

export function parseFastpJson(json: string): FastpSummary {
  const d = JSON.parse(json);
  const bf = d.summary?.before_filtering ?? {};
  const af = d.summary?.after_filtering ?? {};
  const fr = d.filtering_result ?? {};

  return {
    before: {
      totalReads: bf.total_reads ?? 0,
      totalBases: bf.total_bases ?? 0,
      q20Rate:    (bf.q20_rate ?? 0) * 100,
      q30Rate:    (bf.q30_rate ?? 0) * 100,
      gcContent:  (bf.gc_content ?? 0) * 100,
    },
    after: {
      totalReads: af.total_reads ?? 0,
      totalBases: af.total_bases ?? 0,
      q20Rate:    (af.q20_rate ?? 0) * 100,
      q30Rate:    (af.q30_rate ?? 0) * 100,
      gcContent:  (af.gc_content ?? 0) * 100,
    },
    filtering: {
      passed:      fr.passed_filter_reads ?? 0,
      lowQuality:  fr.low_quality_reads ?? 0,
      tooManyN:    fr.too_many_N_reads ?? 0,
      tooShort:    fr.too_short_reads ?? 0,
      tooLong:     fr.too_long_reads ?? 0,
    },
  };
}

function pctColor(pct: number, thresholdGood: number, thresholdWarn: number): string {
  if (pct >= thresholdGood) return '#10b981';
  if (pct >= thresholdWarn) return '#f59e0b';
  return '#ef4444';
}

function fmtBases(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} Gbp`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} Mbp`;
  return `${(b / 1e3).toFixed(1)} Kbp`;
}

export function fastpToToolOutput(r: FastpSummary): ToolOutput {
  const passRate = r.before.totalReads > 0
    ? (r.filtering.passed / r.before.totalReads) * 100
    : 0;

  const beforeStats: StatsSection = {
    type: 'stats',
    cols: 5,
    items: [
      {
        label: 'Total Reads',
        value: r.before.totalReads.toLocaleString(),
        description: 'Raw input reads before filtering.',
      },
      {
        label: 'Total Bases',
        value: fmtBases(r.before.totalBases),
        description: 'Total base pairs before filtering.',
      },
      {
        label: 'Q20',
        value: `${r.before.q20Rate.toFixed(1)}%`,
        color: pctColor(r.before.q20Rate, 95, 85),
        description: 'Bases with Phred quality ≥20 (error rate <1%).',
      },
      {
        label: 'Q30',
        value: `${r.before.q30Rate.toFixed(1)}%`,
        color: pctColor(r.before.q30Rate, 90, 75),
        description: 'Bases with Phred quality ≥30 (error rate <0.1%).',
      },
      {
        label: 'GC Content',
        value: `${r.before.gcContent.toFixed(1)}%`,
        description: 'GC base percentage. Typical range: 40–60%.',
      },
    ],
  };

  const filterStats: StatsSection = {
    type: 'stats',
    cols: 5,
    items: [
      {
        label: 'Passed Filter',
        value: `${passRate.toFixed(1)}%`,
        color: pctColor(passRate, 90, 70),
        description: `${r.filtering.passed.toLocaleString()} reads passed all filters.`,
      },
      {
        label: 'Q30 (after)',
        value: `${r.after.q30Rate.toFixed(1)}%`,
        color: pctColor(r.after.q30Rate, 90, 75),
        description: 'Q30 rate after trimming and filtering.',
      },
      {
        label: 'Low Quality',
        value: r.filtering.lowQuality.toLocaleString(),
        description: 'Reads removed due to low base quality.',
      },
      {
        label: 'Too Short',
        value: r.filtering.tooShort.toLocaleString(),
        description: 'Reads removed for being too short after trimming.',
      },
      {
        label: 'Too Many N',
        value: r.filtering.tooManyN.toLocaleString(),
        description: 'Reads removed for excessive uncalled bases.',
      },
    ],
  };

  return { sections: [beforeStats, filterStats] };
}
