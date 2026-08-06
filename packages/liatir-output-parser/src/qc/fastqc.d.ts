import type { ToolOutput } from '../types';
export type FastqcArgs = {
    /** Absolute path to a FASTQ file (plain or gzipped). */
    input: string;
    /** Stop after this many reads — useful for quick previews on huge files. */
    maxReads?: number;
    /** Max milliseconds to wait for the WASM module (default 300 000). */
    timeoutMs?: number;
};
export type FastqcResult = {
    readCount: number;
    totalBases: number;
    meanLength: number;
    minLength: number;
    maxLength: number;
    /** Mean Phred quality score across all bases. */
    meanQuality: number;
    /** GC content (fraction 0–1). */
    gcContent: number;
    /** Per-position mean Phred score (index 0 = position 1). */
    qualityPerPosition: number[];
};
/** Build the rendered ToolOutput from a FastQC WASM result. */
export declare function fastqcToToolOutput(r: FastqcResult): ToolOutput;
//# sourceMappingURL=fastqc.d.ts.map