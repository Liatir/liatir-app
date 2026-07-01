import type { PipelineStepDefinition } from '$lib/types/pipeline';
import { threadInputSchema } from '$lib/utils/execution-resources';

// Parsers now live in the shared @liatir/output-parser package (single source of truth).
export { parseFastpJson, fastpToToolOutput, type FastpSummary } from '@liatir/output-parser';

export const fastpDefinition: PipelineStepDefinition = {
  id: 'fastp',
  type: 'native-tool',
  label: 'fastp',
  description: 'FASTQ quality trimming, adapter removal, and QC reporting.',
  category: 'Quality Control',
  inputSchema: {
    r1: { type: 'file', label: 'R1 FASTQ', required: true, accept: ['fastq', 'fastq.gz', 'fq', 'fq.gz'] },
    r2: { type: 'file', label: 'R2 FASTQ (optional, paired-end)', required: false, accept: ['fastq', 'fastq.gz', 'fq', 'fq.gz'] },
    threads: threadInputSchema('Worker threads for fastp. 0 lets Liatir choose a safe local value.'),
  },
  outputSchema: {
    trimmedR1:   { type: 'file',   label: 'Trimmed R1', ext: ['fastq.gz'] },
    trimmedR2:   { type: 'file',   label: 'Trimmed R2', ext: ['fastq.gz'], description: 'Only produced in paired-end mode.' },
    stats:       { type: 'stats',  label: 'QC statistics' },
    readsBefore: { type: 'number', label: 'Reads (input)', format: 'integer' },
    q30After:    { type: 'number', label: 'Q30 % (after)', format: 'percent' },
    passRate:    { type: 'number', label: 'Passed %',      format: 'percent' },
  },
};
