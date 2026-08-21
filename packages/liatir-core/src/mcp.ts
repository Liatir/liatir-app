/** Version of Liatir's controlled local MCP surface. */
export const LIATIR_MCP_SCHEMA_VERSION = 1 as const;

/** Current MCP revision implemented by the local server. */
export const LIATIR_MCP_PROTOCOL_VERSION = "2026-07-28" as const;

export const LIATIR_MCP_TOOL_NAMES = {
  startSavedPipeline: "start_saved_pipeline",
  cancelPipelineRun: "cancel_pipeline_run",
  cancelJob: "cancel_job",
} as const;

export const LIATIR_MCP_RESOURCE_URIS = {
  activeWorkspace: "liatir://workspace/active",
  allowedPipelines: "liatir://workspace/active/pipelines",
  runs: "liatir://runs",
  jobs: "liatir://jobs",
  results: "liatir://results",
  artifacts: "liatir://artifacts",
  runStatusTemplate: "liatir://runs/{run_id}/status",
  runLogsTemplate: "liatir://runs/{run_id}/logs",
  runResultTemplate: "liatir://runs/{run_id}/result",
  jobTemplate: "liatir://jobs/{job_id}",
  resultTemplate: "liatir://results/{result_id}",
  artifactTemplate: "liatir://artifacts/{artifact_id}",
  artifactContentTemplate:
    "liatir://artifacts/{artifact_id}/content/{offset}/{length}",
} as const;

/** Self-reported MCP client identity. It is audit metadata, never an authority. */
export interface LiatirMcpClientIdentity {
  name: string;
  version?: string;
}

/** A grant is bound to one saved revision and becomes stale after any edit. */
export interface LiatirMcpPipelineGrant {
  schemaVersion: typeof LIATIR_MCP_SCHEMA_VERSION;
  workspaceId: string;
  pipelineId: string;
  pipelineName: string;
  pipelineRevision: string;
  inputs: LiatirMcpPipelineInputDescriptor[];
  allowedAt: number;
}

export interface LiatirMcpPipelineInputOption {
  value: string;
  label: string;
  description?: string;
}

/** One run-time value that an MCP client may supply to a saved pipeline. */
export interface LiatirMcpPipelineInputDescriptor {
  id: string;
  nodeId: string;
  nodeLabel: string;
  fieldKey: string;
  label: string;
  type: import("./index").LiatirInputFieldType;
  required: boolean;
  source: "node-input" | "variable" | "api-parameter";
  description?: string;
  accept?: string[];
  options?: LiatirMcpPipelineInputOption[];
  artifact?: import("./scientific-artifacts").LiatirArtifactRequirement;
}

/** File inputs are logical workspace artifacts, never caller-provided paths. */
export interface LiatirMcpArtifactInput {
  artifactId: string;
}

export type LiatirMcpPipelineInputValue =
  | string
  | number
  | boolean
  | LiatirMcpArtifactInput;

export type LiatirMcpPipelineInputs = Record<string, LiatirMcpPipelineInputValue>;

/** Explicit access to a source file registered in the active Data workspace. */
export interface LiatirMcpDataFileGrant {
  schemaVersion: typeof LIATIR_MCP_SCHEMA_VERSION;
  workspaceId: string;
  artifactId: string;
  name: string;
  allowedAt: number;
}

/** Path-free description returned for an MCP-readable registered file. */
export interface LiatirMcpArtifactDescriptor {
  schemaVersion: typeof LIATIR_MCP_SCHEMA_VERSION;
  artifactId: string;
  name: string;
  extension: string;
  size?: number;
  folder: string;
  mediaType?: string;
  scientificArtifactId?: string;
  access: "mcp-result" | "workspace-results" | "data-grant";
  resultIds: string[];
  metadataUri: string;
  contentTemplate: string;
}

export type LiatirMcpRunStatus =
  | "awaiting-authorization"
  | "queued"
  | "running"
  | "cancel-requested"
  | "denied"
  | "done"
  | "error"
  | "cancelled"
  | "interrupted";

/** Durable control record allocated before a saved pipeline may start. */
export interface LiatirMcpRunRequest {
  schemaVersion: typeof LIATIR_MCP_SCHEMA_VERSION;
  runId: string;
  workspaceId: string;
  workspaceName: string;
  pipelineId: string;
  pipelineName: string;
  pipelineRevision: string;
  inputSchema: LiatirMcpPipelineInputDescriptor[];
  inputs: LiatirMcpPipelineInputs;
  client: LiatirMcpClientIdentity;
  status: LiatirMcpRunStatus;
  requestedAt: number;
  authorizedAt?: number;
  deniedAt?: number;
  startedAt?: number;
  cancelRequestedAt?: number;
  endedAt?: number;
  resultId?: string;
  error?: string | null;
}

export type LiatirMcpAuditAction =
  | "server-enabled"
  | "server-disabled"
  | "token-rotated"
  | "pipeline-allowed"
  | "pipeline-revoked"
  | "results-read-enabled"
  | "results-read-disabled"
  | "data-file-allowed"
  | "data-file-revoked"
  | "resource-listed"
  | "resource-read"
  | "run-requested"
  | "run-authorized"
  | "run-denied"
  | "run-started"
  | "run-cancel-requested"
  | "job-cancel-requested"
  | "run-finished"
  | "request-rejected";

export type LiatirMcpAuditOutcome = "allowed" | "denied" | "completed" | "failed";

export interface LiatirMcpAuditRecord {
  schemaVersion: typeof LIATIR_MCP_SCHEMA_VERSION;
  id: string;
  timestamp: number;
  action: LiatirMcpAuditAction;
  outcome: LiatirMcpAuditOutcome;
  client?: LiatirMcpClientIdentity;
  workspaceId?: string;
  pipelineId?: string;
  runId?: string;
  detail?: string;
}

/** Native-only connection information shown to the user in Settings. */
export interface LiatirMcpServerStatus {
  schemaVersion: typeof LIATIR_MCP_SCHEMA_VERSION;
  enabled: boolean;
  endpoint: string | null;
  bearerToken: string;
  allowlist: LiatirMcpPipelineGrant[];
  readResults: boolean;
  dataAllowlist: LiatirMcpDataFileGrant[];
  pendingCount: number;
}

/** Saved pipeline revisions are monotonic timestamps allocated by the pipeline store. */
export function liatirMcpPipelineRevision(updatedAt: number): string {
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    throw new Error("updatedAt must be a non-negative safe integer.");
  }
  return String(updatedAt);
}
