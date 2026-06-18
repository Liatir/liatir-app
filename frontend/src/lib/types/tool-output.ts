export interface StatItem {
  label: string;
  value: string | number;
  color?: string;
  description?: string;
}

export interface StatsSection {
  type: 'stats';
  cols?: number;
  items: StatItem[];
}

export interface NumberSection {
  type: 'number';
  label: string;
  value: number;
  unit?: string;
  color?: string;
  format?: 'integer' | 'decimal' | 'percent' | 'bytes';
  description?: string;
}

export interface PlotlySection {
  type: 'plotly';
  plotlyType: string;
  title?: string;
  subtitle?: string;
  description?: string;
  data: object[];
  layout?: object;
}

export interface TextSection {
  type: 'text';
  label: string;
  content: string;
  mono?: boolean;
  description?: string;
}

export interface TableSection {
  type: 'table';
  label: string;
  headers: string[];
  rows: (string | number)[][];
}

export type ToolSection = StatsSection | NumberSection | PlotlySection | TextSection | TableSection;

export interface ToolOutput {
  sections: ToolSection[];
}
