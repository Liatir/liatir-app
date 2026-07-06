import type { ToolOutput } from '../types';
export interface FastpSummary {
    before: {
        totalReads: number;
        totalBases: number;
        q20Rate: number;
        q30Rate: number;
        gcContent: number;
    };
    after: {
        totalReads: number;
        totalBases: number;
        q20Rate: number;
        q30Rate: number;
        gcContent: number;
    };
    filtering: {
        passed: number;
        lowQuality: number;
        tooManyN: number;
        tooShort: number;
        tooLong: number;
    };
}
/** Parse the fastp `--json` report. */
export declare function parseFastpJson(json: string): FastpSummary;
/** Build the rendered ToolOutput (before/after stats) from a parsed summary. */
export declare function fastpToToolOutput(r: FastpSummary): ToolOutput;
//# sourceMappingURL=fastp.d.ts.map