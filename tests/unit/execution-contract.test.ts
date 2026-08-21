import { describe, expect, it } from "vitest";

import {
  assertLiatirExecutionIdentity,
  createLiatirChildExecutionIdentity,
  createLiatirExternalWorkflowRunIdentity,
  createLiatirNestedExternalWorkflowRunIdentity,
  createLiatirRootExecutionIdentity,
  finalizeLiatirExecutionRecord,
  liatirExecutionMetadata,
  type LiatirExecutionRecord,
} from "@liatir/core";

describe("common execution identity", () => {
  it("inherits stable workspace, root and pipeline identities for nested runs", () => {
    const root = createLiatirRootExecutionIdentity({
      runId: "pipeline-run",
      runKind: "pipeline",
      workspaceId: "workspace-a",
      pipelineId: "pipeline-definition",
      initiator: {
        kind: "mcp",
        requestId: "mcp-request",
        clientName: "real-mcp-client",
        clientVersion: "1.0.0",
      },
    });
    const step = createLiatirChildExecutionIdentity(root, {
      runId: "step-run",
      runKind: "pipeline-step",
      nodeId: "node-a",
      entityId: "fastp",
    });
    const nested = createLiatirChildExecutionIdentity(step, {
      runId: "nested-run",
      runKind: "lia-plugin",
      nodeId: "nested-node",
      entityId: "plugin-a",
    });

    expect(root.pipelineRunId).toBe("pipeline-run");
    expect(step).toMatchObject({
      workspaceId: "workspace-a",
      rootRunId: "pipeline-run",
      parentRunId: "pipeline-run",
      pipelineRunId: "pipeline-run",
      initiator: {
        kind: "mcp",
        requestId: "mcp-request",
      },
    });
    expect(nested).toMatchObject({
      workspaceId: "workspace-a",
      rootRunId: "pipeline-run",
      parentRunId: "step-run",
      pipelineRunId: "pipeline-run",
    });
    expect(liatirExecutionMetadata(nested)).toEqual({ execution: nested });
  });

  it("reserves a stable standalone External Workflow Run identity", () => {
    const identity = createLiatirExternalWorkflowRunIdentity({
      runId: "external-run",
      workspaceId: "workspace-a",
      entityId: "workflow-definition",
    });

    expect(identity).toMatchObject({
      runKind: "external-workflow",
      runId: "external-run",
      rootRunId: "external-run",
      externalWorkflowRunId: "external-run",
    });
    expect(() => assertLiatirExecutionIdentity({
      ...identity,
      externalWorkflowRunId: "different-run",
    })).toThrow(/External Workflow Run/);
  });

  it("keeps a nested External Workflow Run distinct from its pipeline parent", () => {
    const pipeline = createLiatirRootExecutionIdentity({
      runId: "pipeline-run",
      runKind: "pipeline",
      workspaceId: "workspace-a",
      pipelineId: "pipeline-definition",
    });
    const external = createLiatirNestedExternalWorkflowRunIdentity(pipeline, {
      runId: "nextflow-run",
      nodeId: "nextflow-node",
      entityId: "saved-nextflow-workflow",
    });
    const task = createLiatirChildExecutionIdentity(external, {
      runId: "nextflow-task",
      runKind: "external-workflow-step",
      nodeId: "process-align",
    });

    expect(external).toMatchObject({
      runId: "nextflow-run",
      parentRunId: "pipeline-run",
      rootRunId: "pipeline-run",
      pipelineRunId: "pipeline-run",
      externalWorkflowRunId: "nextflow-run",
    });
    expect(task).toMatchObject({
      parentRunId: "nextflow-run",
      externalWorkflowRunId: "nextflow-run",
      rootRunId: "pipeline-run",
    });
  });

  it("keeps the first terminal outcome when observers finalize more than once", () => {
    const identity = createLiatirRootExecutionIdentity({
      runId: "plugin-run",
      runKind: "lia-plugin",
      workspaceId: "workspace-a",
    });
    const record: LiatirExecutionRecord = {
      identity,
      label: "Plugin",
      status: "running",
      resultPolicy: "own",
      resultId: identity.runId,
      jobIds: [],
      logs: [],
      startedAt: 10,
      updatedAt: 10,
    };

    const done = finalizeLiatirExecutionRecord(record, "done", 20);
    const lateFailure = finalizeLiatirExecutionRecord(done, "error", 30, "late");

    expect(lateFailure).toBe(done);
    expect(lateFailure).toMatchObject({ status: "done", endedAt: 20 });
  });
});
