import type { ToolOutput, StatsSection, TableSection } from '$lib/types/tool-output';
import type { PipelineStepDefinition } from '$lib/types/pipeline';

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

// ── ANN field parser ──────────────────────────────────────────────

export interface AnnEntry {
  allele: string;
  effect: string;
  impact: 'HIGH' | 'MODERATE' | 'LOW' | 'MODIFIER' | string;
  geneName: string;
  geneId: string;
  hgvsCds: string;
  hgvsProtein: string;
}

export function parseAnnField(annValue: string): AnnEntry[] {
  // Multiple transcripts separated by comma
  return annValue.split(',').map(entry => {
    const parts = entry.split('|');
    return {
      allele:      parts[0] ?? '',
      effect:      parts[1] ?? '',
      impact:      parts[2] ?? '',
      geneName:    parts[3] ?? '',
      geneId:      parts[4] ?? '',
      hgvsCds:     parts[9] ?? '',
      hgvsProtein: parts[10] ?? '',
    };
  });
}

export function impactColor(impact: string): string {
  switch (impact) {
    case 'HIGH':     return '#ef4444';
    case 'MODERATE': return '#f59e0b';
    case 'LOW':      return '#10b981';
    default:         return '#71717a';
  }
}

// ── Output builder ────────────────────────────────────────────────

export interface SnpEffSummary {
  totalVariants: number;
  highImpact: number;
  moderateImpact: number;
  lowImpact: number;
  modifierImpact: number;
  topEffects: Array<{ effect: string; count: number }>;
}

export function buildSnpEffOutput(
  summary: SnpEffSummary,
  outputVcfName: string,
): ToolOutput {
  const stats: StatsSection = {
    type: 'stats',
    cols: 4,
    items: [
      { label: 'Total variants', value: summary.totalVariants.toLocaleString() },
      {
        label: 'HIGH impact',
        value: summary.highImpact.toLocaleString(),
        color: '#ef4444',
        description: 'Stop gained, frameshift, splice site disruption',
      },
      {
        label: 'MODERATE impact',
        value: summary.moderateImpact.toLocaleString(),
        color: '#f59e0b',
        description: 'Missense, in-frame indel',
      },
      {
        label: 'LOW impact',
        value: summary.lowImpact.toLocaleString(),
        color: '#10b981',
        description: 'Synonymous, splice region',
      },
    ],
  };

  const topTable: TableSection = {
    type: 'table',
    label: 'Top effects',
    headers: ['Effect', 'Count'],
    rows: summary.topEffects.slice(0, 15).map(e => [e.effect, e.count]),
  };

  return { sections: [stats, topTable] };
}

// ── Parse SnpEff text summary (genes.txt / snpEff_summary.txt) ───

export function parseSnpEffStats(stdout: string): SnpEffSummary {
  const lines = stdout.split('\n');

  let totalVariants = 0;
  let highImpact = 0;
  let moderateImpact = 0;
  let lowImpact = 0;
  let modifierImpact = 0;
  const effectCounts: Map<string, number> = new Map();

  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;

    // SnpEff stats lines look like:
    // "Number of variants (total)" ... "12345"
    const trimmed = line.trim();

    if (trimmed.includes('HIGH')) {
      const m = trimmed.match(/(\d+)\s*$/);
      if (m) highImpact = parseInt(m[1], 10);
    }
    if (trimmed.includes('MODERATE')) {
      const m = trimmed.match(/(\d+)\s*$/);
      if (m) moderateImpact = parseInt(m[1], 10);
    }
    if (trimmed.includes('LOW')) {
      const m = trimmed.match(/(\d+)\s*$/);
      if (m) lowImpact = parseInt(m[1], 10);
    }
    if (trimmed.includes('MODIFIER')) {
      const m = trimmed.match(/(\d+)\s*$/);
      if (m) modifierImpact = parseInt(m[1], 10);
    }
  }

  totalVariants = highImpact + moderateImpact + lowImpact + modifierImpact;

  return {
    totalVariants,
    highImpact,
    moderateImpact,
    lowImpact,
    modifierImpact,
    topEffects: [],
  };
}
