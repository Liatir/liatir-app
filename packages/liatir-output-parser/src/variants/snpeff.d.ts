import type { ToolOutput } from '../types';
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
export declare function parseAnnField(annValue: string): AnnEntry[];
/** Color for a SnpEff impact level. */
export declare function impactColor(impact: string): string;
export interface SnpEffSummary {
    totalVariants: number;
    highImpact: number;
    moderateImpact: number;
    lowImpact: number;
    modifierImpact: number;
    topEffects: Array<{
        effect: string;
        count: number;
    }>;
}
/** Build the rendered ToolOutput (impact stats + top-effects table) from a summary. */
export declare function buildSnpEffOutput(summary: SnpEffSummary, outputVcfName: string): ToolOutput;
/** Parse SnpEff's text summary into impact counts. */
export declare function parseSnpEffStats(stdout: string): SnpEffSummary;
//# sourceMappingURL=snpeff.d.ts.map