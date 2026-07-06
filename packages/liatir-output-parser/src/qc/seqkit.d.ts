import type { ToolOutput } from '../types';
export interface SeqkitStatsResult {
    file: string;
    format: string;
    type: string;
    numSeqs: number;
    sumLen: number;
    minLen: number;
    avgLen: number;
    maxLen: number;
    q1: number | null;
    q2: number | null;
    q3: number | null;
    n50: number | null;
    q20Pct: number | null;
    q30Pct: number | null;
    gcPct: number | null;
}
/** Parse `seqkit stats` (optionally `-a`) tabular stdout. Returns null if unparseable. */
export declare function parseSeqkitStats(stdout: string): SeqkitStatsResult | null;
/** Build the rendered ToolOutput (stats grid + raw text) from a parsed result. */
export declare function seqkitStatsToToolOutput(r: SeqkitStatsResult, rawStdout: string): ToolOutput;
//# sourceMappingURL=seqkit.d.ts.map