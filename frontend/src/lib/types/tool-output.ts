// Canonical ToolOutput types now live in the shared @liatir/output-parser package
// (single source of truth — also used by the @liatir/sdk adapter and the browser SDK).
// Re-exported here so the rest of the frontend keeps importing from $lib/types/tool-output.
export type {
  StatItem,
  StatsSection,
  NumberSection,
  PlotlySection,
  TextSection,
  TableSection,
  ToolSection,
  ToolOutput,
} from '@liatir/output-parser';
