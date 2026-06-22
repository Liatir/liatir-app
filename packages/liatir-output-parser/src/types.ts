// Canonical ToolOutput types — the shape every Liatir tool/result is rendered from.
//
// This is the SINGLE source of truth. The frontend (`$lib/types/tool-output`),
// the @liatir/sdk adapter, and the browser SDK all re-export these instead of
// keeping their own copies, so a change here propagates everywhere.

export interface StatItem {
  label: string;
  value: string | number;
  color?: string;
  description?: string;
}

/** A grid of labelled metric cards. */
export interface StatsSection {
  type: 'stats';
  cols?: number;
  items: StatItem[];
}

/** A single large metric with unit/format. */
export interface NumberSection {
  type: 'number';
  label: string;
  value: number;
  unit?: string;
  color?: string;
  format?: 'integer' | 'decimal' | 'percent' | 'bytes';
  description?: string;
}

/** An interactive Plotly chart (bar, scatter, heatmap, …). */
export interface PlotlySection {
  type: 'plotly';
  plotlyType: string;
  title?: string;
  subtitle?: string;
  description?: string;
  data: object[];
  layout?: object;
}

/** A block of text — optionally monospace. */
export interface TextSection {
  type: 'text';
  label: string;
  content: string;
  mono?: boolean;
  description?: string;
  /** Raw command stdout/stderr dump — redundant with the run log; excluded from HTML export. */
  raw?: boolean;
}

/** A simple table (headers + rows). */
export interface TableSection {
  type: 'table';
  label: string;
  headers: string[];
  rows: (string | number)[][];
}

export type ToolSection =
  | StatsSection
  | NumberSection
  | PlotlySection
  | TextSection
  | TableSection;

export interface ToolOutput {
  sections: ToolSection[];
}
