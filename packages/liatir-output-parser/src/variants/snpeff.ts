// SnpEff — ANN field parser, impact colors, summary parser and ToolOutput builder.
// Pure functions; migrated from the frontend. parseAnnField/impactColor are shared
// with future variant tools (e.g. ESM-2 variant effect).

import type { ToolOutput, StatsSection, TableSection } from '../types';

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

/** Parse a VCF INFO `ANN=` value into per-transcript entries. */
export function parseAnnField(annValue: string): AnnEntry[] {
  // Multiple transcripts separated by comma
  return annValue.split(',').map((entry) => {
    const parts = entry.split('|');
    return {
      allele: parts[0] ?? '',
      effect: parts[1] ?? '',
      impact: parts[2] ?? '',
      geneName: parts[3] ?? '',
      geneId: parts[4] ?? '',
      hgvsCds: parts[9] ?? '',
      hgvsProtein: parts[10] ?? '',
    };
  });
}

/** Color for a SnpEff impact level. */
export function impactColor(impact: string): string {
  switch (impact) {
    case 'HIGH':
      return '#ef4444';
    case 'MODERATE':
      return '#f59e0b';
    case 'LOW':
      return '#10b981';
    default:
      return '#71717a';
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

/** Build the rendered ToolOutput (impact stats + top-effects table) from a summary. */
export function buildSnpEffOutput(summary: SnpEffSummary, outputVcfName: string): ToolOutput {
  const stats: StatsSection = {
    type: 'stats',
    cols: 4,
    items: [
      { label: 'Total variants', value: summary.totalVariants.toLocaleString() },
      { label: 'HIGH impact', value: summary.highImpact.toLocaleString(), color: '#ef4444', description: 'Stop gained, frameshift, splice site disruption' },
      { label: 'MODERATE impact', value: summary.moderateImpact.toLocaleString(), color: '#f59e0b', description: 'Missense, in-frame indel' },
      { label: 'LOW impact', value: summary.lowImpact.toLocaleString(), color: '#10b981', description: 'Synonymous, splice region' },
    ],
  };

  const topTable: TableSection = {
    type: 'table',
    label: 'Top effects',
    headers: ['Effect', 'Count'],
    rows: summary.topEffects.slice(0, 15).map((e) => [e.effect, e.count]),
  };

  return { sections: [stats, topTable] };
}

// ── Parse SnpEff text summary (genes.txt / snpEff_summary.txt) ───

/** Parse SnpEff's text summary into impact counts. */
export function parseSnpEffStats(stdout: string): SnpEffSummary {
  const lines = stdout.split('\n');

  let highImpact = 0;
  let moderateImpact = 0;
  let lowImpact = 0;
  let modifierImpact = 0;

  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;
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

  const totalVariants = highImpact + moderateImpact + lowImpact + modifierImpact;

  return { totalVariants, highImpact, moderateImpact, lowImpact, modifierImpact, topEffects: [] };
}
