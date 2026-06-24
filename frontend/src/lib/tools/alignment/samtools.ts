import type { PipelineStepDefinition } from '$lib/types/pipeline';

// Parsers now live in the shared @liatir/output-parser package (single source of truth).
export { parseFlagstatResult, flagstatToToolOutput, type FlagstatResult } from '@liatir/output-parser';

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
    stats:         { type: 'stats',  label: 'Alignment statistics' },
    total:         { type: 'number', label: 'Total reads',   format: 'integer' },
    mappedPct:     { type: 'number', label: 'Mapped %',      format: 'percent' },
    duplicatesPct: { type: 'number', label: 'Duplicates %',  format: 'percent' },
  },
};
