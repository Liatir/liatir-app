import type { PipelineStepDefinition } from '$lib/types/pipeline';

// Parsers + ANN helpers now live in the shared @liatir/output-parser package
// (single source of truth). UI constants and the step definition stay here.
export {
  parseAnnField,
  impactColor,
  buildSnpEffOutput,
  parseSnpEffStats,
  type AnnEntry,
  type SnpEffSummary,
} from '@liatir/output-parser';

export const snpeffDefinition: PipelineStepDefinition = {
  id: 'snpeff',
  type: 'native-tool',
  label: 'SnpEff',
  description: 'Annotate VCF variants with functional effects (missense, nonsense, splice site…)',
  category: 'Variant Calling',
  inputSchema: {
    inputFile: { type: 'file', label: 'VCF file', required: true, accept: ['vcf', 'vcf.gz'] },
    genome:    { type: 'string', label: 'Genome database', required: true, default: 'GRCh38.115' },
  },
  outputSchema: {
    annotatedVcf:   { type: 'file',   label: 'Annotated VCF', ext: ['vcf'] },
    stats:          { type: 'stats',  label: 'Annotation summary' },
    totalVariants:  { type: 'number', label: 'Total variants', format: 'integer' },
    highImpact:     { type: 'number', label: 'HIGH impact',    format: 'integer' },
    moderateImpact: { type: 'number', label: 'MODERATE impact', format: 'integer' },
    lowImpact:      { type: 'number', label: 'LOW impact',     format: 'integer' },
  },
};
