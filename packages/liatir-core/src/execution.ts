import type { JsonValue, LiatirStepKind, LiatirStepStatus } from "./index";

/** Version of the durable execution identity and lifecycle record. */
export const LIATIR_EXECUTION_SCHEMA_VERSION = 1 as const;

/**
 * The entity that owns an execution. A run kind describes ownership, not the
 * implementation used to execute it, so new runners can reuse this contract.
 */
export type LiatirExecutionRunKind =
  | "pipeline"
  | "pipeline-step"
  | "external-workflow"
  | "external-workflow-step"
  | "native-tool"
  | "tool-runtime"
  | "ai-model"
  | "ai-tool"
  | "lia-plugin"
  | "api-request"
  | "dependency";

export type LiatirExecutionStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "done"
  | "error"
  | "cancelled"
  | "interrupted";

export type LiatirExecutionTerminalStatus = Extract<
  LiatirExecutionStatus,
  "done" | "error" | "cancelled" | "interrupted"
>;

/** Whether this run owns a Result, contributes to its parent, or has no Result. */
export type LiatirExecutionResultPolicy = "own" | "parent" | "none";

/** The actor that requested a root run. Child runs inherit it unchanged. */
export type LiatirExecutionInitiator =
  | { kind: "user" }
  | {
      kind: "mcp";
      requestId: string;
      clientName: string;
      clientVersion?: string;
    };

/**
 * Stable identity allocated before work starts and copied unchanged into Jobs,
 * Results and artifact provenance.
 */
export interface LiatirExecutionIdentity {
  schemaVersion: typeof LIATIR_EXECUTION_SCHEMA_VERSION;
  runId: string;
  runKind: LiatirExecutionRunKind;
  workspaceId: string;
  rootRunId: string;
  parentRunId?: string;
  pipelineId?: string | null;
  pipelineRunId?: string;
  externalWorkflowRunId?: string;
  nodeId?: string;
  entityId?: string;
  initiator?: LiatirExecutionInitiator;
}

/** External workflows have their own stable identity, whether direct or nested. */
export interface LiatirExternalWorkflowRunIdentity extends LiatirExecutionIdentity {
  runKind: "external-workflow";
  externalWorkflowRunId: string;
}

export interface LiatirExecutionProgress {
  current: number;
  total?: number | null;
  label?: string | null;
  done: boolean;
}

export interface LiatirExecutionLogEntry {
  timestampMs: number;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  stream?: "stdout" | "stderr" | "system";
}

/** Durable, workspace-scoped lifecycle state for one independently owned run. */
export interface LiatirExecutionRecord {
  identity: LiatirExecutionIdentity;
  label: string;
  status: LiatirExecutionStatus;
  resultPolicy: LiatirExecutionResultPolicy;
  resultId?: string;
  jobIds: string[];
  inputs?: JsonValue;
  params?: JsonValue;
  logs: LiatirExecutionLogEntry[];
  progress?: LiatirExecutionProgress | null;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  error?: string | null;
  finalizedAt?: number;
}

export interface LiatirRootExecutionIdentityInput {
  runId: string;
  runKind: Exclude<LiatirExecutionRunKind, "pipeline-step" | "external-workflow-step">;
  workspaceId: string;
  pipelineId?: string | null;
  entityId?: string;
  initiator?: LiatirExecutionInitiator;
}

export interface LiatirChildExecutionIdentityInput {
  runId: string;
  runKind: Exclude<LiatirExecutionRunKind, "pipeline">;
  nodeId?: string;
  entityId?: string;
}

function requireNonEmpty(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} must be a non-empty string.`);
}

export function isLiatirExecutionTerminalStatus(
  status: LiatirExecutionStatus,
): status is LiatirExecutionTerminalStatus {
  return status === "done" || status === "error" || status === "cancelled" || status === "interrupted";
}

/** Create a top-level run. Its run ID is also its root identity. */
export function createLiatirRootExecutionIdentity(
  input: LiatirRootExecutionIdentityInput,
): LiatirExecutionIdentity {
  requireNonEmpty(input.runId, "runId");
  requireNonEmpty(input.workspaceId, "workspaceId");

  const identity: LiatirExecutionIdentity = {
    schemaVersion: LIATIR_EXECUTION_SCHEMA_VERSION,
    runId: input.runId,
    runKind: input.runKind,
    workspaceId: input.workspaceId,
    rootRunId: input.runId,
    ...(input.pipelineId !== undefined ? { pipelineId: input.pipelineId } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.initiator ? { initiator: input.initiator } : {}),
  };

  if (input.runKind === "pipeline") identity.pipelineRunId = input.runId;
  if (input.runKind === "external-workflow") identity.externalWorkflowRunId = input.runId;
  return identity;
}

/**
 * Create a child identity. Root, workspace and orchestration identities are
 * inherited from the parent and cannot be replaced by the child.
 */
export function createLiatirChildExecutionIdentity(
  parent: LiatirExecutionIdentity,
  input: LiatirChildExecutionIdentityInput,
): LiatirExecutionIdentity {
  assertLiatirExecutionIdentity(parent);
  requireNonEmpty(input.runId, "runId");
  if (input.runId === parent.runId) throw new Error("A child runId must differ from its parent runId.");

  return {
    schemaVersion: LIATIR_EXECUTION_SCHEMA_VERSION,
    runId: input.runId,
    runKind: input.runKind,
    workspaceId: parent.workspaceId,
    rootRunId: parent.rootRunId,
    parentRunId: parent.runId,
    ...(parent.pipelineId !== undefined ? { pipelineId: parent.pipelineId } : {}),
    ...(parent.pipelineRunId ? { pipelineRunId: parent.pipelineRunId } : {}),
    ...(input.runKind === "external-workflow"
      ? { externalWorkflowRunId: input.runId }
      : parent.externalWorkflowRunId
        ? { externalWorkflowRunId: parent.externalWorkflowRunId }
      : {}),
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(parent.initiator ? { initiator: parent.initiator } : {}),
  };
}

/** Create the stable identity reserved for a standalone External Workflow Run. */
export function createLiatirExternalWorkflowRunIdentity(
  input: Omit<LiatirRootExecutionIdentityInput, "runKind">,
): LiatirExternalWorkflowRunIdentity {
  return createLiatirRootExecutionIdentity({ ...input, runKind: "external-workflow" }) as LiatirExternalWorkflowRunIdentity;
}

/** Create an External Workflow Run owned by a pipeline or another orchestrator. */
export function createLiatirNestedExternalWorkflowRunIdentity(
  parent: LiatirExecutionIdentity,
  input: Omit<LiatirChildExecutionIdentityInput, "runKind">,
): LiatirExternalWorkflowRunIdentity {
  return createLiatirChildExecutionIdentity(parent, {
    ...input,
    runKind: "external-workflow",
  }) as LiatirExternalWorkflowRunIdentity;
}

/** Reject malformed or internally inconsistent identities at trust boundaries. */
export function assertLiatirExecutionIdentity(
  identity: LiatirExecutionIdentity,
): void {
  if (identity.schemaVersion !== LIATIR_EXECUTION_SCHEMA_VERSION) {
    throw new Error(`Unsupported execution identity schema version: ${identity.schemaVersion}.`);
  }
  requireNonEmpty(identity.runId, "runId");
  requireNonEmpty(identity.workspaceId, "workspaceId");
  requireNonEmpty(identity.rootRunId, "rootRunId");
  if (identity.parentRunId === identity.runId) {
    throw new Error("parentRunId must differ from runId.");
  }
  if (!identity.parentRunId && identity.rootRunId !== identity.runId) {
    throw new Error("A root execution must use its runId as rootRunId.");
  }
  if (identity.parentRunId && identity.rootRunId === identity.runId) {
    throw new Error("A child execution cannot replace its inherited rootRunId.");
  }
  if (identity.runKind === "pipeline" && identity.pipelineRunId !== identity.runId) {
    throw new Error("A Pipeline Run must use its runId as pipelineRunId.");
  }
  if (
    identity.runKind === "external-workflow" &&
    identity.externalWorkflowRunId !== identity.runId
  ) {
    throw new Error("An External Workflow Run must use its runId as externalWorkflowRunId.");
  }
  if (identity.runKind === "pipeline-step" && !identity.pipelineRunId) {
    throw new Error("A pipeline-step identity requires pipelineRunId.");
  }
  if (identity.runKind === "external-workflow-step" && !identity.externalWorkflowRunId) {
    throw new Error("An external-workflow-step identity requires externalWorkflowRunId.");
  }
  if (identity.initiator?.kind === "mcp") {
    requireNonEmpty(identity.initiator.requestId, "initiator.requestId");
    requireNonEmpty(identity.initiator.clientName, "initiator.clientName");
  }
}

/** JSON metadata copied into every backend Job spawned for this run. */
export function liatirExecutionMetadata(
  identity: LiatirExecutionIdentity,
): Record<string, JsonValue> {
  assertLiatirExecutionIdentity(identity);
  return { execution: identity as unknown as JsonValue };
}

/**
 * Terminal transitions are first-writer-wins. Repeated observers therefore
 * cannot rewrite a completed run or change its scientific outcome.
 */
export function finalizeLiatirExecutionRecord(
  record: LiatirExecutionRecord,
  status: LiatirExecutionTerminalStatus,
  endedAt: number,
  error: string | null = null,
): LiatirExecutionRecord {
  if (isLiatirExecutionTerminalStatus(record.status)) return record;
  return {
    ...record,
    status,
    endedAt,
    updatedAt: endedAt,
    error,
  };
}

// ---------------------------------------------------------------------------
// On-disk run folder
// ---------------------------------------------------------------------------

/** Version of the `runs/<runId>/` folder layout described below. */
export const LIATIR_RUN_RECORD_SCHEMA_VERSION = 1 as const;

/**
 * Every run in Liatir owns one directory, whatever produced it and whether it ran on its own or as
 * a node inside a pipeline:
 *
 * ```
 * runs/<runId>/
 *   metadata.json   what this run was          (LiatirRunMetadata)
 *   result.json     the parsed output Liatir renders
 *   log.jsonl       the transcript, one LiatirExecutionLogEntry per line
 *   steps.json      pipelines only             (LiatirRunSteps)
 *   output/         the files the run produced
 * ```
 *
 * The layout is **flat**: a pipeline's steps are ordinary runs in `runs/` alongside it, referenced
 * from its `steps.json`, not nested inside it. Nesting would make the same code handle two shapes
 * and would recurse without bound through sub-pipelines; references do not.
 *
 * The directory is created on first write, so a run that produces nothing has none — which is the
 * correct answer to "what did it leave behind", not a missing case to handle.
 */
export interface LiatirRunMetadata {
  schemaVersion: typeof LIATIR_RUN_RECORD_SCHEMA_VERSION;
  runId: string;
  runKind: LiatirExecutionRunKind;
  /** Tool, model, plugin or workflow this run executed, when it has one. */
  entityId?: string;
  label: string;
  status: "done" | "error" | "cancelled";
  startedAt: number;
  endedAt: number;
  durationMs: number;
  error: string | null;
  inputs: string[];
  params: Record<string, JsonValue>;
  workspaceId?: string;
  /** Present when this run is a node inside another. Empty for a run started on its own. */
  parent?: {
    pipelineRunId?: string;
    pipelineId?: string | null;
    parentRunId?: string;
    nodeId?: string;
  };
}

/**
 * One node of a pipeline run.
 *
 * A step that executed something — a tool, a model, a workflow, an API call — points at its own run
 * directory through `runId`, and its files, transcript and parameters live there like any other
 * run's. A utility node (variable, math, condition) computes a value rather than running a process:
 * it still has an identity, but no directory is created for it, and its result is recorded here
 * instead. Enumerating a run directory that was never created correctly reports nothing.
 */
export interface LiatirRunStep {
  nodeId: string;
  kind: LiatirStepKind | "utility";
  label: string;
  runId: string;
  status: LiatirStepStatus;
  /** Absent for a node that never started — skipped by a branch, or never reached. */
  startedAt?: number;
  endedAt?: number;
  error: string | null;
  /** The computed result of a utility node, which has no output files to point at. */
  value?: JsonValue;
  /**
   * For a condition node: the branch it actually took. Says which of its outgoing connections
   * carried on and which was abandoned, without the reader having to infer it from which of
   * `trueBranch`/`falseBranch` in `value` came out empty.
   */
  activeBranch?: "true" | "false";
}

/**
 * One connection between two steps, as the graph stood when the run executed.
 *
 * Named by handle on both ends because that is what carries the meaning: a condition node's
 * outputs are `trueBranch` and `falseBranch`, so the handle is what says which branch a downstream
 * step hangs off. Recorded once per edge rather than duplicated onto both endpoints, which is the
 * shape that goes stale.
 */
export interface LiatirRunStepConnection {
  /** `nodeId` of the step the value comes from. */
  from: string;
  /** Output handle on `from`. */
  output: string | null;
  /** `nodeId` of the step it feeds. */
  to: string;
  /** Input handle on `to`. */
  input: string | null;
}

/**
 * A pipeline run's `steps.json`: what ran, and how it was wired.
 *
 * **`steps` is ordered by when each step started**, so the file reads in the order things actually
 * happened. There is no index field, because a pipeline is a graph and not a sequence: steps with no
 * dependency between them can start together, and numbering them would assert an order that does
 * not exist. Steps that never started — skipped by a branch, or never reached — come last, in graph
 * order, since they have no start time to sort by.
 *
 * **`connections` is what makes it a graph rather than a list.** It answers what feeds what, and
 * which branch of a condition leads where. The order steps ran in does not imply it: two adjacent
 * entries may be unrelated, and a step may depend on one that finished long before.
 */
export interface LiatirRunSteps {
  schemaVersion: typeof LIATIR_RUN_RECORD_SCHEMA_VERSION;
  steps: LiatirRunStep[];
  connections: LiatirRunStepConnection[];
}
