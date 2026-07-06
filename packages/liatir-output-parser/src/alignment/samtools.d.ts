import type { ToolOutput } from '../types';
export interface FlagstatResult {
    total: number;
    mapped: number;
    mappedPct: number | null;
    duplicates: number;
    duplicatesPct: number | null;
    properlyPaired: number;
    properlyPairedPct: number | null;
    singletons: number;
    singletonsPct: number | null;
    secondary: number;
    supplementary: number;
}
/** Parse `samtools flagstat` stdout. */
export declare function parseFlagstatResult(stdout: string): FlagstatResult;
/** Build the rendered ToolOutput (mapping stats + raw text) from a parsed result. */
export declare function flagstatToToolOutput(r: FlagstatResult, rawStdout: string): ToolOutput;
//# sourceMappingURL=samtools.d.ts.map