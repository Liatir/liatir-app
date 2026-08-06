export type FastqcArgs = {
    /** Absolute path to a FASTQ file (plain or gzipped .fastq / .fq / .fastq.gz) */
    input: string;
    /** Stop after this many reads — useful for quick previews on huge files */
    maxReads?: number;
    /** Max milliseconds to wait for the WASM module to complete (default 300 000) */
    timeoutMs?: number;
};
export type FastqcResult = {
    readCount: number;
    totalBases: number;
    meanLength: number;
    minLength: number;
    maxLength: number;
    /** Mean Phred quality score across all bases */
    meanQuality: number;
    /** GC content as a percentage (0–100) */
    gcContent: number;
    /** Per-position mean Phred score (index 0 = position 1) */
    qualityPerPosition: number[];
};
import type { ToolOutput } from "../_types";
export interface FastqcInterface {
    run: (args: FastqcArgs) => Promise<ToolOutput>;
}
