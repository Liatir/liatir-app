import type { FastqcInterface } from "./fastqc/_types";
import type { LiatirNumberSection, LiatirPlotlySection, LiatirStatItem, LiatirStatsSection, LiatirTextSection, LiatirToolOutput, LiatirToolSection } from "@liatir/core";
export type QcInterface = {
    fastqc: FastqcInterface;
};
export type StatItem = LiatirStatItem;
export type StatsSection = LiatirStatsSection;
export type NumberSection = LiatirNumberSection;
export type PlotlySection = LiatirPlotlySection;
export type TextSection = LiatirTextSection;
export type ToolSection = LiatirToolSection;
export type ToolOutput = LiatirToolOutput;
