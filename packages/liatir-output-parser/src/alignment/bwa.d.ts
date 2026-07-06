import type { ToolOutput } from '../types';
export interface BwaMemStats {
    logLines: number;
    warnings: number;
    duration: string | null;
}
/** Parse BWA-MEM stderr lines (warnings + wall time). */
export declare function parseBwaMemStats(stderr: string[]): BwaMemStats;
/** Build the rendered ToolOutput from parsed stats + raw stderr. */
export declare function bwaMemToToolOutput(stats: BwaMemStats, stderrRaw: string, outputPath: string): ToolOutput;
//# sourceMappingURL=bwa.d.ts.map