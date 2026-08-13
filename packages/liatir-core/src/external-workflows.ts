import type {
  JsonValue,
  LiatirArtifactDeclaration,
  LiatirArtifactRequirement,
  LiatirInputFieldSchema,
  LiatirOutputFieldSchema,
  LiatirStepDefinition,
} from "./index";

/** Version of the saved External Workflow definition contract. */
export const LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION = 1 as const;

/** Prefix used by pipeline nodes that reference a saved External Workflow. */
export const LIATIR_EXTERNAL_WORKFLOW_STEP_PREFIX = "external-workflow:" as const;

export type LiatirExternalWorkflowEngine = "nextflow";

/**
 * Local workflows are selected through their main script. Liatir snapshots the
 * whole containing directory for every run so imported modules and config stay
 * beside the script without mutating the user's source tree.
 */
export interface LiatirExternalWorkflowLocalSource {
  kind: "local";
  mainScriptPath: string;
}

/** A repository workflow is always paired with an explicit tag or commit. */
export interface LiatirExternalWorkflowRepositorySource {
  kind: "repository";
  repository: string;
  revision: string;
  /** Optional script path inside the repository, passed to Nextflow as `-main-script`. */
  mainScript?: string;
}

export type LiatirExternalWorkflowSource =
  | LiatirExternalWorkflowLocalSource
  | LiatirExternalWorkflowRepositorySource;

export type LiatirExternalWorkflowScalarType = "string" | "number" | "boolean";

export interface LiatirExternalWorkflowParameter {
  key: string;
  label: string;
  description?: string;
  type: LiatirExternalWorkflowScalarType;
  required?: boolean;
  default?: JsonValue;
}

export interface LiatirExternalWorkflowInput {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
  accept?: string[];
  artifact?: LiatirArtifactRequirement;
}

/**
 * An exact path below the run's declared output directory. Wildcards are not
 * accepted: only files explicitly mapped here become reusable Liatir data.
 */
export interface LiatirExternalWorkflowOutput {
  key: string;
  label: string;
  relativePath: string;
  ext: string;
  mediaType?: string;
  artifact?: LiatirArtifactDeclaration;
}

export interface LiatirExternalWorkflowNextflowOptions {
  /** Comma-separated Nextflow profile names. */
  profile?: string;
  /** Optional local config file staged and fingerprinted for every run. */
  configFilePath?: string;
  /** Optional named DSL2 workflow entry point. */
  entryWorkflow?: string;
}

/** First-class, workspace-scoped definition referenced by both UI and pipelines. */
export interface LiatirExternalWorkflowDefinition {
  schemaVersion: typeof LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION;
  id: string;
  name: string;
  description: string;
  engine: LiatirExternalWorkflowEngine;
  source: LiatirExternalWorkflowSource;
  parameters: LiatirExternalWorkflowParameter[];
  inputs: LiatirExternalWorkflowInput[];
  outputs: LiatirExternalWorkflowOutput[];
  /** Nextflow parameter that receives the isolated run output directory. */
  outputDirectoryParameter: string;
  nextflow?: LiatirExternalWorkflowNextflowOptions;
  createdAt: number;
  updatedAt: number;
}

export interface LiatirExternalWorkflowTaskSummary {
  process: string;
  status: string;
  exitCode?: number | null;
  duration?: string;
  workDirectory?: string;
}

export interface LiatirExternalWorkflowRunLocations {
  runDirectory: string;
  launchDirectory: string;
  workDirectory: string;
  outputDirectory: string;
  sourceSnapshot?: string;
  paramsFile: string;
  logFile: string;
  traceFile: string;
  reportFile: string;
  timelineFile: string;
  dagFile: string;
}

/** Immutable engine evidence saved with an External Workflow Result. */
export interface LiatirExternalWorkflowRunProvenance {
  schemaVersion: typeof LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION;
  definitionId: string;
  definitionUpdatedAt: number;
  engine: LiatirExternalWorkflowEngine;
  engineVersion: string | null;
  javaVersion: string | null;
  source: LiatirExternalWorkflowSource;
  sourceSnapshotSha256?: string;
  configSha256?: string;
  profile?: string;
  entryWorkflow?: string;
  platform: string;
  architecture: string;
  command: string[];
  parameters: Record<string, JsonValue>;
  inputs: Array<{
    key: string;
    originalPath: string;
    stagedPath: string;
    sizeBytes: number;
    sha256: string;
  }>;
  locations: LiatirExternalWorkflowRunLocations;
  jobId: string;
  sessionId?: string;
  exitCode: number | null;
  finalStatus: "done" | "error" | "cancelled";
  resumedFromRunId?: string;
  tasks: LiatirExternalWorkflowTaskSummary[];
  outputs: Array<{
    key: string;
    path: string;
    sizeBytes: number;
    sha256: string;
  }>;
  startedAt: number;
  endedAt: number;
}

const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REPOSITORY_BRANCH_NAMES = new Set(["main", "master", "develop", "development", "dev", "head"]);

function requireText(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} must be a non-empty string.`);
}

function validateFieldKey(value: string, field: string): void {
  requireText(value, field);
  if (!FIELD_KEY.test(value)) {
    throw new Error(`${field} must start with a letter or underscore and contain only letters, numbers and underscores.`);
  }
}

function validateExactRelativePath(value: string, field: string): void {
  requireText(value, field);
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error(`${field} must stay inside the declared workflow output directory.`);
  }
  if (/[*?[\]{}]/.test(normalized)) {
    throw new Error(`${field} must be an exact path; wildcard output mappings are not supported.`);
  }
}

/** Reject malformed saved definitions before they cross a storage or execution boundary. */
export function assertLiatirExternalWorkflowDefinition(
  definition: LiatirExternalWorkflowDefinition,
): void {
  if (definition.schemaVersion !== LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION) {
    throw new Error(`Unsupported External Workflow schema version: ${definition.schemaVersion}.`);
  }
  requireText(definition.id, "id");
  requireText(definition.name, "name");
  if (definition.engine !== "nextflow") {
    throw new Error(`Unsupported External Workflow engine: ${String(definition.engine)}.`);
  }

  if (definition.source.kind === "local") {
    requireText(definition.source.mainScriptPath, "source.mainScriptPath");
  } else if (definition.source.kind === "repository") {
    requireText(definition.source.repository, "source.repository");
    requireText(definition.source.revision, "source.revision");
    if (REPOSITORY_BRANCH_NAMES.has(definition.source.revision.trim().toLowerCase())) {
      throw new Error("source.revision must be a version tag or commit, not a moving branch name.");
    }
    if (definition.source.mainScript) {
      validateExactRelativePath(definition.source.mainScript, "source.mainScript");
    }
  } else {
    throw new Error("source.kind must be local or repository.");
  }

  validateFieldKey(definition.outputDirectoryParameter, "outputDirectoryParameter");

  const seen = new Set<string>();
  for (const parameter of definition.parameters) {
    validateFieldKey(parameter.key, "parameter key");
    requireText(parameter.label, `parameter ${parameter.key} label`);
    if (seen.has(parameter.key)) throw new Error(`Duplicate External Workflow field key: ${parameter.key}.`);
    seen.add(parameter.key);
    if (parameter.key === definition.outputDirectoryParameter) {
      throw new Error(`Field ${parameter.key} conflicts with outputDirectoryParameter.`);
    }
    if (parameter.default !== undefined) {
      if (parameter.type === "string" && typeof parameter.default !== "string") {
        throw new Error(`Default for ${parameter.key} must be a string.`);
      }
      if (parameter.type === "number" && (typeof parameter.default !== "number" || !Number.isFinite(parameter.default))) {
        throw new Error(`Default for ${parameter.key} must be a finite number.`);
      }
      if (parameter.type === "boolean" && typeof parameter.default !== "boolean") {
        throw new Error(`Default for ${parameter.key} must be a boolean.`);
      }
    }
  }

  for (const input of definition.inputs) {
    validateFieldKey(input.key, "input key");
    requireText(input.label, `input ${input.key} label`);
    if (seen.has(input.key)) throw new Error(`Duplicate External Workflow field key: ${input.key}.`);
    seen.add(input.key);
    if (input.key === definition.outputDirectoryParameter) {
      throw new Error(`Field ${input.key} conflicts with outputDirectoryParameter.`);
    }
  }

  const outputKeys = new Set<string>();
  const outputPaths = new Set<string>();
  for (const output of definition.outputs) {
    validateFieldKey(output.key, "output key");
    requireText(output.label, `output ${output.key} label`);
    requireText(output.ext, `output ${output.key} ext`);
    validateExactRelativePath(output.relativePath, `output ${output.key} relativePath`);
    if (outputKeys.has(output.key)) throw new Error(`Duplicate External Workflow output key: ${output.key}.`);
    const normalizedPath = output.relativePath.replaceAll("\\", "/");
    if (outputPaths.has(normalizedPath)) {
      throw new Error(`Duplicate External Workflow output path: ${normalizedPath}.`);
    }
    outputKeys.add(output.key);
    outputPaths.add(normalizedPath);
  }
  if (definition.outputs.length === 0) {
    throw new Error("An External Workflow must declare at least one exact output mapping.");
  }

  if (!Number.isFinite(definition.createdAt) || !Number.isFinite(definition.updatedAt)) {
    throw new Error("createdAt and updatedAt must be finite timestamps.");
  }
  if (definition.updatedAt < definition.createdAt) {
    throw new Error("updatedAt cannot be earlier than createdAt.");
  }
}

/** Build the one pipeline contract used by the saved definition in every run mode. */
export function externalWorkflowToStepDefinition(
  definition: LiatirExternalWorkflowDefinition,
): LiatirStepDefinition {
  assertLiatirExternalWorkflowDefinition(definition);

  const inputSchema: Record<string, LiatirInputFieldSchema> = {};
  for (const input of definition.inputs) {
    inputSchema[input.key] = {
      type: "file",
      label: input.label,
      description: input.description,
      required: input.required,
      accept: input.accept,
      artifact: input.artifact,
    };
  }
  for (const parameter of definition.parameters) {
    inputSchema[parameter.key] = {
      type: parameter.type,
      label: parameter.label,
      description: parameter.description,
      required: parameter.required,
      default: parameter.default,
    } as LiatirInputFieldSchema;
  }

  const outputSchema: Record<string, LiatirOutputFieldSchema> = {};
  for (const output of definition.outputs) {
    outputSchema[output.key] = {
      type: "file",
      label: output.label,
      ext: [output.ext],
      artifact: output.artifact,
    };
  }

  return {
    id: `${LIATIR_EXTERNAL_WORKFLOW_STEP_PREFIX}${definition.id}`,
    type: "external-workflow",
    label: definition.name,
    description: definition.description || "Run this saved External Workflow with Nextflow.",
    category: "External Workflows",
    inputSchema,
    outputSchema,
  };
}
