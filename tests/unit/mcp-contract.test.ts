import { describe, expect, it } from "vitest";

import {
  LIATIR_MCP_PROTOCOL_VERSION,
  LIATIR_MCP_RESOURCE_URIS,
  LIATIR_MCP_TOOL_NAMES,
  liatirMcpDataFolderCovers,
  liatirMcpGrantableFolder,
  liatirMcpIsSourceFolder,
  liatirMcpPipelineRevision,
} from "@liatir/core";

describe("controlled MCP contract", () => {
  it("exposes only owner-aware pipeline and Job mutations", () => {
    expect(LIATIR_MCP_PROTOCOL_VERSION).toBe("2026-07-28");
    expect(Object.values(LIATIR_MCP_TOOL_NAMES)).toEqual([
      "start_saved_pipeline",
      "cancel_pipeline_run",
      "cancel_job",
    ]);
    expect(Object.values(LIATIR_MCP_TOOL_NAMES)).not.toContain("shell");
  });

  it("keeps lifecycle, Results, Jobs, and artifact content as scoped resources", () => {
    expect(LIATIR_MCP_RESOURCE_URIS.runStatusTemplate).toMatch(/\/status$/);
    expect(LIATIR_MCP_RESOURCE_URIS.runLogsTemplate).toMatch(/\/logs$/);
    expect(LIATIR_MCP_RESOURCE_URIS.runResultTemplate).toMatch(/\/result$/);
    expect(LIATIR_MCP_RESOURCE_URIS.jobTemplate).toBe("liatir://jobs/{job_id}");
    expect(LIATIR_MCP_RESOURCE_URIS.resultTemplate).toBe("liatir://results/{result_id}");
    expect(LIATIR_MCP_RESOURCE_URIS.artifactContentTemplate).toContain("{offset}/{length}");
  });

  it("binds an allowlist grant to the saved pipeline revision", () => {
    expect(liatirMcpPipelineRevision(1_725_000_000_000)).toBe("1725000000000");
    expect(() => liatirMcpPipelineRevision(-1)).toThrow(/non-negative/);
    expect(() => liatirMcpPipelineRevision(Number.MAX_VALUE)).toThrow(/safe integer/);
  });
});

describe("standing Data folder grants", () => {
  it("covers the granted folder and everything nested under it", () => {
    expect(liatirMcpDataFolderCovers("Inputs", "Inputs")).toBe(true);
    expect(liatirMcpDataFolderCovers("Inputs", "Inputs/patient-1")).toBe(true);
    expect(liatirMcpDataFolderCovers("Inputs", "Inputs-archive")).toBe(false);
    expect(liatirMcpDataFolderCovers("Inputs", "")).toBe(false);
  });

  it("refuses the Data root, so no grant can mean every future file", () => {
    expect(liatirMcpGrantableFolder("Inputs")).toBe(true);
    expect(liatirMcpGrantableFolder("")).toBe(false);
    expect(liatirMcpGrantableFolder("   ")).toBe(false);
    expect(liatirMcpGrantableFolder("/")).toBe(false);
  });

  it("leaves Results to the separate workspace Result permission", () => {
    expect(liatirMcpIsSourceFolder("Inputs")).toBe(true);
    expect(liatirMcpIsSourceFolder("Results")).toBe(false);
    expect(liatirMcpIsSourceFolder("Results/run-1")).toBe(false);
    expect(liatirMcpGrantableFolder("Results")).toBe(false);
    expect(liatirMcpDataFolderCovers("Inputs", "Results/run-1")).toBe(false);
  });
});
