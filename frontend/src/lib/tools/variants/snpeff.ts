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
    genome:    { type: 'string', label: 'Genome', required: true, default: 'hg38' },
  },
  outputSchema: {
    annotatedVcf: { type: 'file', label: 'Annotated VCF', ext: ['vcf'] },
    stats:        { type: 'stats', label: 'Annotation summary' },
  },
};

// Common genomes available in SnpEff database — IDs match the S3 bucket filenames exactly.
// Check https://snpeff-public.s3.amazonaws.com/ for the current list.
export const SNPEFF_GENOMES = [
  { id: 'GRCh38.115',   label: 'Human GRCh38.115 (Ensembl 115)' },
  { id: 'hg38',         label: 'Human hg38 (UCSC / v5_0)' },
  { id: 'hg19',         label: 'Human hg19 / GRCh37 (UCSC)' },
  { id: 'GRCm39.115',   label: 'Mouse GRCm39.115 (Ensembl 115)' },
  { id: 'mm10',         label: 'Mouse mm10 / GRCm38 (UCSC / v5_0)' },
  { id: 'GRCz11.115',   label: 'Zebrafish GRCz11.115 (Ensembl 115)' },
  { id: 'BDGP6.115',    label: 'Drosophila BDGP6.115 (Ensembl 115)' },
  { id: 'WBcel235.115', label: 'C. elegans WBcel235.115 (Ensembl 115)' },
  { id: 'R64-1-1.115',  label: 'Yeast R64-1-1.115 (Ensembl 115)' },
];

export const SNPEFF_DOWNLOAD_URL = 'https://pcingola.github.io/SnpEff/#download';
