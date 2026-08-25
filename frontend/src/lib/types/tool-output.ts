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
  StructureViewerSection,
  MolecularTrajectoryViewerSection,
  GenomeViewerSection,
  SingleCellViewerSection,
  ToolSection,
  ToolOutput,
} from '@liatir/core';
