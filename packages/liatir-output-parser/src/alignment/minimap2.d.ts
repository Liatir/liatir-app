import type { ToolOutput } from '../types';
export declare const MINIMAP2_PRESETS: readonly [{
    readonly value: "sr";
    readonly label: "Short reads (Illumina)";
    readonly description: "Paired-end short reads, optimized for Illumina.";
}, {
    readonly value: "map-ont";
    readonly label: "ONT reads";
    readonly description: "Oxford Nanopore long reads.";
}, {
    readonly value: "map-pb";
    readonly label: "PacBio CLR";
    readonly description: "PacBio continuous long reads.";
}, {
    readonly value: "map-hifi";
    readonly label: "PacBio HiFi";
    readonly description: "PacBio CCS / HiFi high-accuracy reads.";
}, {
    readonly value: "asm5";
    readonly label: "Assembly (asm5)";
    readonly description: "Sequence divergence ≤5% — genome assembly alignment.";
}, {
    readonly value: "asm20";
    readonly label: "Assembly (asm20)";
    readonly description: "Sequence divergence ≤20%.";
}];
export type Minimap2Preset = (typeof MINIMAP2_PRESETS)[number]['value'];
export interface Minimap2Stats {
    totalReads: number | null;
    duration: string | null;
}
/** Parse minimap2 stderr lines (reads processed + wall time). */
export declare function parseMinimap2Stats(stderr: string[]): Minimap2Stats;
/** Build the rendered ToolOutput from parsed stats + raw stderr. */
export declare function minimap2ToToolOutput(stats: Minimap2Stats, stderrRaw: string, outputPath: string, preset: string): ToolOutput;
//# sourceMappingURL=minimap2.d.ts.map