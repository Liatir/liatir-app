import type { ToolOutput } from '../types';
export interface BcftoolsStatsResult {
    samples: number;
    records: number;
    snps: number;
    mnps: number;
    indels: number;
    multiallelic: number;
    multiallelicSnps: number;
    transitions: number;
    transversions: number;
    tstv: number | null;
}
/** Parse `bcftools stats` stdout. */
export declare function parseBcftoolsStats(stdout: string): BcftoolsStatsResult;
/** Build the rendered ToolOutput (variant stats + raw text) from a parsed result. */
export declare function bcftoolsStatsToToolOutput(r: BcftoolsStatsResult, rawStdout: string): ToolOutput;
//# sourceMappingURL=bcftools.d.ts.map