// Canonical ToolOutput types live in @liatir/core.
// Re-exported here so existing frontend imports keep working while the contract
// remains owned by one shared package.
export type {
  StatItem,
  StatsSection,
  NumberSection,
  PlotlySection,
  TextSection,
  TableSection,
  ToolSection,
  ToolOutput,
} from '@liatir/core';
