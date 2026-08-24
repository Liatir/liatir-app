// simpleaf / alevin-fry — parse the JSON reports a single-cell run leaves behind.
// Pure functions; the app and @liatir/api render the same numbers from the same files.
//
// Read from the reports rather than from the matrix: a real experiment's matrix is hundreds
// of megabytes and its shape is already stated exactly in `quant.json`.

import type { ToolOutput, StatsSection, TableSection } from '../types';

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

function asRecord(json: string, what: string): Record<string, any> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`${what} is not readable JSON.`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${what} is not readable JSON.`);
  }
  return parsed as Record<string, any>;
}

/** Parse piscem's `map_info.json`. */
export function parseSimpleafMapInfo(json: string): SimpleafMappingSummary {
  const d = asRecord(json, 'The mapping report');
  const reads = Number(d.num_reads ?? 0);
  const mapped = Number(d.num_mapped ?? 0);
  const reported = Number(d.percent_mapped);
  return {
    reads,
    mapped,
    percentMapped: Number.isFinite(reported)
      ? reported
      : reads > 0
        ? (mapped / reads) * 100
        : 0,
    // piscem records its own version, not its name; the report only exists because it ran.
    mapper: typeof d.piscem_rs_version === 'string' ? `piscem ${d.piscem_rs_version}` : 'piscem',
  };
}

/** Parse alevin-fry's `generate_permit_list.json`. */
export function parseAlevinFryPermitList(json: string): AlevinFryPermitSummary {
  const d = asRecord(json, 'The cell-detection report');
  const stats = (d.correction_stats ?? {}) as Record<string, unknown>;
  const method = (d.gpl_options ?? {}) as Record<string, unknown>;
  const chosen = method.fmeth;
  return {
    exactReads: Number(stats.exact_reads ?? 0),
    correctedReads: Number(stats.corrected_reads ?? 0),
    discardedReads:
      Number(stats.not_found_reads ?? 0) + Number(stats.ambiguous_reads ?? 0),
    method:
      typeof chosen === 'string'
        ? chosen
        : typeof chosen === 'object' && chosen !== null
          ? Object.keys(chosen)[0] ?? 'unknown'
          : 'unknown',
  };
}

/** Parse alevin-fry's `quant.json`. */
export function parseAlevinFryQuant(json: string): AlevinFryQuantSummary {
  const d = asRecord(json, 'The quantification report');
  const usaMode = d.usa_mode === true;
  const columns = Number(d.num_genes ?? 0);
  const cells = Number(d.num_quantified_cells ?? 0);
  if (!Number.isFinite(columns) || columns <= 0) {
    throw new Error('The quantification report records no genes.');
  }
  if (usaMode && columns % 3 !== 0) {
    throw new Error(
      'The quantification report claims USA mode but its gene count is not divisible by three.',
    );
  }
  return {
    cells,
    genes: usaMode ? columns / 3 : columns,
    usaMode,
    resolution: typeof d.resolution_strategy === 'string' ? d.resolution_strategy : 'unknown',
    version: typeof d.version_str === 'string' ? d.version_str : 'unknown',
  };
}

/**
 * The gene identifiers of a USA-mode matrix, in matrix order.
 *
 * `quants_mat_cols.txt` lists every gene three times — plain, then suffixed `-U` for the
 * unspliced block and `-A` for the ambiguous one. The first block is the gene list.
 */
export function parseAlevinFryGeneIds(contents: string, usaMode: boolean): string[] {
  const all = contents.split(/\r?\n/).filter((line) => line.length > 0);
  if (!usaMode) return all;
  if (all.length % 3 !== 0) {
    throw new Error('The gene column list does not divide into three USA-mode blocks.');
  }
  return all.slice(0, all.length / 3);
}

function pctColor(pct: number, good: number, warn: number): string {
  if (pct >= good) return '#10b981';
  if (pct >= warn) return '#f59e0b';
  return '#ef4444';
}

const CELL_METHOD_LABELS: Record<string, string> = {
  KneeFinding: 'detected automatically (knee)',
  ExplicitList: 'from the barcode list you supplied',
  ForceCells: 'a fixed number you asked for',
  ExpectCells: 'an expected number you asked for',
  UnfilteredExternalList: 'from the manufacturer barcode list',
};

/** Build the rendered ToolOutput for a finished quantification. */
export function alevinFryToToolOutput(input: {
  mapping: SimpleafMappingSummary;
  permit: AlevinFryPermitSummary;
  quant: AlevinFryQuantSummary;
  matrixFileName: string;
}): ToolOutput {
  const { mapping, permit, quant } = input;
  const attributed = permit.exactReads + permit.correctedReads;
  const barcodeTotal = attributed + permit.discardedReads;
  const attributedPct = barcodeTotal > 0 ? (attributed / barcodeTotal) * 100 : 0;

  const overview: StatsSection = {
    type: 'stats',
    cols: 4,
    items: [
      {
        label: 'Cells',
        value: quant.cells.toLocaleString(),
        description: 'Cell barcodes kept and quantified.',
      },
      {
        label: 'Genes',
        value: quant.genes.toLocaleString(),
        description: 'Genes in the count matrix — one column each.',
      },
      {
        label: 'Reads mapped',
        value: `${mapping.percentMapped.toFixed(1)}%`,
        color: pctColor(mapping.percentMapped, 70, 50),
        description: `${mapping.mapped.toLocaleString()} of ${mapping.reads.toLocaleString()} reads matched the reference.`,
      },
      {
        label: 'Barcodes kept',
        value: `${attributedPct.toFixed(1)}%`,
        color: pctColor(attributedPct, 90, 70),
        description: `${permit.correctedReads.toLocaleString()} reads were rescued from a one-letter barcode error.`,
      },
    ],
  };

  const provenance: TableSection = {
    type: 'table',
    label: 'How this matrix was made',
    headers: ['Step', 'Detail'],
    rows: [
      ['Matrix', input.matrixFileName],
      ['Mapper', mapping.mapper],
      ['Cells chosen', CELL_METHOD_LABELS[permit.method] ?? permit.method],
      ['UMI resolution', quant.resolution],
      ['Counts', quant.usaMode ? 'spliced + unspliced + ambiguous' : 'spliced only'],
      ['alevin-fry', quant.version],
    ],
  };

  return { sections: [overview, provenance] };
}
