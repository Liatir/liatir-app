// @liatir/core
//
// Global Liatir contracts shared by every executable node type:
// native tools, Node .lia plugins, WASM .lia tools, API calls, future AI tools, utility nodes, and sub-pipelines.
//
// This package is the single source of truth for schema and result shapes.
// UI components, the SDK, the CLI, parsers, and pipeline code should import or re-export these types instead of mirroring them manually.
// Built-in AI model catalog — the single source of truth shared by the app UI
// and the plugin API (@liatir/api Liatir.ai). Model ids, metadata, and runtime
// specs live here so neither side hand-duplicates the list.
export * from "./ai-catalog";
