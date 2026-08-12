import type { JsonValue } from "./index";

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
