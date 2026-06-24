import type { PipelineStepDefinition } from '$lib/types/pipeline';

// Parsers now live in the shared @liatir/output-parser package (single source of truth).
export { parseBcftoolsStats, bcftoolsStatsToToolOutput, type BcftoolsStatsResult } from '@liatir/output-parser';

export const bcftoolsFilterDefinition: PipelineStepDefinition = {
  id: 'bcftools-filter',
  type: 'native-tool',
  label: 'BCFtools filter',
  description: 'Filter VCF/BCF variants by quality, depth, or any INFO/FORMAT field.',
  category: 'Variant Calling',
  inputSchema: {
    inputFile:  { type: 'file',   label: 'VCF / BCF file',   required: true,  accept: ['vcf', 'vcf.gz', 'bcf', 'bcf.gz'] },
    expression: { type: 'string', label: 'Filter expression', required: true,  default: 'QUAL>20' },
  },
  outputSchema: {
    filteredVcf: { type: 'file', label: 'Filtered VCF', ext: ['vcf.gz'] },
  },
};

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
    stats:   { type: 'stats',  label: 'Variant statistics' },
    records: { type: 'number', label: 'Records', format: 'integer' },
    snps:    { type: 'number', label: 'SNPs',    format: 'integer' },
    indels:  { type: 'number', label: 'Indels',  format: 'integer' },
    tstv:    { type: 'number', label: 'Ts/Tv',   format: 'decimal' },
  },
};
