// ToolOutput compatibility layer.
//
// The canonical rendered-output types live in @liatir/core. This package keeps
// re-exporting the historical names so existing parser imports do not fork the
// contract or require a large one-shot migration.

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
