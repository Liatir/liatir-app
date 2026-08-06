import type { PipelineStepDefinition } from '$lib/types/pipeline';
import { threadInputSchema } from '$lib/utils/execution-resources';

// Parsers now live in the shared @liatir/output-parser package (single source of truth).
export { parseBwaMemStats, bwaMemToToolOutput, type BwaMemStats } from '@liatir/output-parser';

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
    threads: threadInputSchema('Worker threads for BWA-MEM. 0 lets Liatir choose a safe local value.'),
  },
  outputSchema: {
    outputSam: { type: 'file', label: 'Output SAM', ext: ['sam'] },
  },
};
