import type { ToolOutput } from '../types';
export interface SimpleafMappingSummary {
    /** Read pairs handed to the mapper. */
    reads: number;
    mapped: number;
    percentMapped: number;
    mapper: string;
}
export interface AlevinFryPermitSummary {
    /** Barcodes matching the permit list exactly. */
    exactReads: number;
    /** Barcodes one error away from a permitted one, recovered rather than discarded. */
    correctedReads: number;
    /** Reads whose barcode could not be attributed to any cell. */
    discardedReads: number;
    /** How the cells were chosen — knee, an explicit list, a forced count. */
    method: string;
}
export interface AlevinFryQuantSummary {
    cells: number;
    /** Genes, not matrix columns: a USA-mode matrix carries three columns per gene. */
    genes: number;
    usaMode: boolean;
    resolution: string;
    version: string;
}
/** Parse piscem's `map_info.json`. */
export declare function parseSimpleafMapInfo(json: string): SimpleafMappingSummary;
/** Parse alevin-fry's `generate_permit_list.json`. */
export declare function parseAlevinFryPermitList(json: string): AlevinFryPermitSummary;
/** Parse alevin-fry's `quant.json`. */
export declare function parseAlevinFryQuant(json: string): AlevinFryQuantSummary;
/**
 * The gene identifiers of a USA-mode matrix, in matrix order.
 *
 * `quants_mat_cols.txt` lists every gene three times — plain, then suffixed `-U` for the
 * unspliced block and `-A` for the ambiguous one. The first block is the gene list.
 */
export declare function parseAlevinFryGeneIds(contents: string, usaMode: boolean): string[];
/** Build the rendered ToolOutput for a finished quantification. */
export declare function alevinFryToToolOutput(input: {
    mapping: SimpleafMappingSummary;
    permit: AlevinFryPermitSummary;
    quant: AlevinFryQuantSummary;
    matrixFileName: string;
}): ToolOutput;
//# sourceMappingURL=simpleaf.d.ts.map