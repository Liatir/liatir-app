import type { PipelineStepDefinition } from '$lib/types/pipeline';
import { threadInputSchema } from '$lib/utils/execution-resources';

// Parsers now live in the shared @liatir/output-parser package (single source of truth,
// also consumed by the @liatir/sdk adapter). The pipeline-step definition stays here.
export { parseSeqkitStats, seqkitStatsToToolOutput, type SeqkitStatsResult } from '@liatir/output-parser';

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
    threads: threadInputSchema('Worker threads for seqkit stats. 0 lets Liatir choose a safe local value.'),
  },
  outputSchema: {
    stats:   { type: 'stats',  label: 'Sequence statistics' },
    numSeqs: { type: 'number', label: 'Sequences', format: 'integer' },
    gcPct:   { type: 'number', label: 'GC %',      format: 'percent' },
    n50:     { type: 'number', label: 'N50',       format: 'integer' },
  },
};
