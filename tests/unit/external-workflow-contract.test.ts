import { describe, expect, it } from "vitest";

import {
  LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION,
  assertLiatirExternalWorkflowDefinition,
  externalWorkflowToStepDefinition,
  type LiatirExternalWorkflowDefinition,
} from "@liatir/core";

function definition(
  overrides: Partial<LiatirExternalWorkflowDefinition> = {},
): LiatirExternalWorkflowDefinition {
  return {
    schemaVersion: LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION,
    id: "workflow-1",
    name: "Cell counter",
    description: "Count cells in one AnnData file.",
    engine: "nextflow",
    source: { kind: "local", mainScriptPath: "/workflows/cells/main.nf" },
    parameters: [
      { key: "minimum_cells", label: "Minimum cells", type: "number", default: 10 },
      { key: "strict", label: "Strict mode", type: "boolean", default: false },
    ],
    inputs: [
      { key: "anndata", label: "AnnData", required: true, accept: ["h5ad"] },
    ],
    outputs: [
      { key: "summary", label: "Summary", relativePath: "summary.csv", ext: "csv" },
    ],
    outputDirectoryParameter: "outdir",
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  };
}

describe("External Workflow contract", () => {
  it("builds the same typed node contract from a saved definition", () => {
    const saved = definition();
    expect(() => assertLiatirExternalWorkflowDefinition(saved)).not.toThrow();

    expect(externalWorkflowToStepDefinition(saved)).toMatchObject({
      id: "external-workflow:workflow-1",
      type: "external-workflow",
      category: "External Workflows",
      inputSchema: {
        anndata: { type: "file", required: true, accept: ["h5ad"] },
        minimum_cells: { type: "number", default: 10 },
        strict: { type: "boolean", default: false },
      },
      outputSchema: {
        summary: { type: "file", ext: ["csv"] },
      },
    });
  });

  it("requires a pinned repository revision and rejects moving branch names", () => {
    expect(() => assertLiatirExternalWorkflowDefinition(definition({
      source: { kind: "repository", repository: "nf-core/rnaseq", revision: "main" },
    }))).toThrow(/tag or commit/);

    expect(() => assertLiatirExternalWorkflowDefinition(definition({
      source: { kind: "repository", repository: "nf-core/rnaseq", revision: "3.21.0" },
    }))).not.toThrow();
  });

  it("only accepts unique, exact output mappings inside the run output directory", () => {
    expect(() => assertLiatirExternalWorkflowDefinition(definition({
      outputs: [{ key: "summary", label: "Summary", relativePath: "../summary.csv", ext: "csv" }],
    }))).toThrow(/stay inside/);

    expect(() => assertLiatirExternalWorkflowDefinition(definition({
      outputs: [{ key: "summary", label: "Summary", relativePath: "*.csv", ext: "csv" }],
    }))).toThrow(/exact path/);

    expect(() => assertLiatirExternalWorkflowDefinition(definition({
      outputs: [
        { key: "first", label: "First", relativePath: "summary.csv", ext: "csv" },
        { key: "second", label: "Second", relativePath: "summary.csv", ext: "csv" },
      ],
    }))).toThrow(/Duplicate External Workflow output path/);
  });

  it("keeps parameter, input and reserved output-directory names unambiguous", () => {
    expect(() => assertLiatirExternalWorkflowDefinition(definition({
      inputs: [{ key: "minimum_cells", label: "Collision" }],
    }))).toThrow(/Duplicate External Workflow field key/);

    expect(() => assertLiatirExternalWorkflowDefinition(definition({
      parameters: [{ key: "outdir", label: "Collision", type: "string" }],
    }))).toThrow(/conflicts with outputDirectoryParameter/);
  });
});
