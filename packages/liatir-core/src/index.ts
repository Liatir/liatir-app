// @liatir/core
//
// Global Liatir contracts shared by every executable node type:
// native tools, Node .lia plugins, WASM .lia tools, API calls, future AI tools, utility nodes, and sub-pipelines.
//
// This package is the single source of truth for schema and result shapes.
// UI components, the SDK, the CLI, parsers, and pipeline code should import or re-export these types instead of mirroring them manually.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type LiatirInputFieldType = "string" | "number" | "boolean" | "file";
export type LiatirOutputFieldType =
  | "string"
  | "number"
  | "boolean"
  | "file"
  | "stats"
  | "json";
export type LiatirFieldType = LiatirInputFieldType | LiatirOutputFieldType;

export type LiatirStepKind =
  | "native-tool"
  | "lia-plugin"
  | "wasm-plugin"
  | "api-request"
  | "ai-tool"
  | "utility"
  | "sub-pipeline";

export interface LiatirFieldOption {
  value: string;
  label: string;
  description?: string;
}

export interface LiatirFieldSchema<TDefault = unknown> {
  type: LiatirFieldType;
  label?: string;
  description?: string;
  required?: boolean;
  default?: TDefault;
  /** Static choices for fields that should be selected instead of free-typed. */
  options?: LiatirFieldOption[];
  /**
   * Accepted file extensions for file fields. Values are extension strings such
   * as "fastq", "fastq.gz", or ".vcf"; consumers must normalize the leading dot.
   */
  accept?: string[];
  /**
   * Whether pipeline editors may bind this field to an upstream output reference.
   * Defaults to true. Use false for local execution controls such as thread counts.
   */
  connectable?: boolean;
}

export interface LiatirInputFieldSchema<
  TDefault = unknown,
> extends LiatirFieldSchema<TDefault> {
  type: LiatirInputFieldType;
}

export interface LiatirOutputFieldSchema extends LiatirFieldSchema {
  type: LiatirOutputFieldType;
  /** Expected extensions for file outputs. Kept for pipeline-port readability. */
  ext?: string[];
  /** Display hint for numeric metric outputs. */
  format?: "integer" | "decimal" | "percent" | "bytes";
}

export interface LiatirStepDefinition {
  id: string;
  type: LiatirStepKind;
  label: string;
  description: string;
  category: string;
  inputSchema: Record<string, LiatirInputFieldSchema>;
  outputSchema: Record<string, LiatirOutputFieldSchema>;
}

export type LiatirPluginRuntime = "node" | "wasm" | "python";

export interface LiatirPythonRuntimePackageInstallOptions {
  /** Install this package with pip build isolation disabled. Used for legacy scientific packages with incomplete build metadata. */
  noBuildIsolation?: boolean;
}

export interface LiatirPythonRuntimePackage {
  package: string;
  version?: string;
  specifier?: string;
  importName?: string;
  installOptions?: LiatirPythonRuntimePackageInstallOptions;
}

export interface LiatirPythonRequirement {
  minVersion?: string;
  maxVersionExclusive?: string;
  label?: string;
  reason?: string;
}

export interface LiatirPythonPluginRuntimeSpec {
  /** Entry file inside the packaged .lia bundle. Generated builds store Python sources under python/. */
  entry: string;
  /** Structured package declarations used by Liatir's managed Python environment. */
  packages?: LiatirPythonRuntimePackage[];
  /** Raw pip requirement specifiers for advanced packages that do not need import checks. */
  requirements?: string[];
  /** Optional interpreter compatibility range for this plugin runtime box. */
  pythonRequirement?: LiatirPythonRequirement;
}

export interface LiatirPluginManifest {
  name: string;
  version: string;
  description?: string;
  runtime: LiatirPluginRuntime;
  category?: string;
  tags?: string[];
  inputSchema: Record<string, LiatirInputFieldSchema>;
  outputSchema: Record<string, LiatirOutputFieldSchema>;
  python?: LiatirPythonPluginRuntimeSpec;
}

export type LiatirFileArtifactRole =
  | "final"
  | "intermediate"
  | "cache"
  | "temp";

export type LiatirArtifactProducerKind =
  | LiatirStepKind
  | "pipeline"
  | "ai-model"
  | "dependency"
  | "system"
  | "unknown";

export interface LiatirArtifactProducer {
  kind: LiatirArtifactProducerKind;
  id: string;
  label?: string;
  version?: string;
  nodeId?: string;
}

export type LiatirArtifactParentRunKind =
  | "tool"
  | "pipeline"
  | "pipeline-step"
  | "ai-model-direct"
  | "dependency"
  | "unknown";

export interface LiatirArtifactParentRun {
  runKind: LiatirArtifactParentRunKind;
  runId: string;
  analysisRunId?: string;
  pipelineId?: string | null;
  pipelineRunId?: string;
  nodeId?: string;
  jobId?: string;
}

export interface LiatirFileArtifact {
  label: string;
  path: string;
  ext: string;
  size?: number;
  /** Artifact lifecycle role. Used by cache and cleanup policy; missing means legacy final output. */
  role?: LiatirFileArtifactRole;
  /** Unix epoch milliseconds when Liatir registered this artifact. */
  createdAt?: number;
  /** Tool, model, pipeline, or system component that produced this artifact. */
  producer?: LiatirArtifactProducer;
  /** Run or job this artifact belongs to. */
  parentRun?: LiatirArtifactParentRun;
  /** Output schema key that produced this artifact, when known. */
  fieldKey?: string;
  /** MIME type or domain-specific media type, when known. */
  mediaType?: string;
}

export interface LiatirFileContentOutput {
  content: string;
  fileName?: string;
  base64?: boolean;
}

export interface LiatirFilePathOutput {
  path: string;
}

/**
 * File-typed node outputs may either reference an existing durable path or ask
 * Liatir to persist inline text/base64 content into the workspace Results area.
 */
export type LiatirFileOutputValue =
  | string
  | LiatirFilePathOutput
  | LiatirFileContentOutput;

export type LiatirOutputValue = JsonValue | LiatirFileOutputValue;

export type LiatirStepStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "cancelled"
  | "skipped";

export type LiatirRunStatus = "done" | "error" | "cancelled";

export interface LiatirStatItem {
  label: string;
  value: string | number;
  color?: string;
  description?: string;
}

export interface LiatirStatsSection {
  type: "stats";
  cols?: number;
  items: LiatirStatItem[];
}

export interface LiatirNumberSection {
  type: "number";
  label: string;
  value: number;
  unit?: string;
  color?: string;
  format?: "integer" | "decimal" | "percent" | "bytes";
  description?: string;
}

export interface LiatirPlotlySection {
  type: "plotly";
  plotlyType: string;
  title?: string;
  subtitle?: string;
  description?: string;
  data: object[];
  layout?: object;
}

export interface LiatirTextSection {
  type: "text";
  label: string;
  content: string;
  mono?: boolean;
  description?: string;
  /** Raw command stdout/stderr dump; redundant with logs and skipped in exports. */
  raw?: boolean;
}

export interface LiatirTableSection {
  type: "table";
  label: string;
  headers: string[];
  rows: (string | number)[][];
}

export type LiatirStructureFormat =
  | "pdb"
  | "cif"
  | "mmcif"
  | "sdf"
  | "mol2"
  | "xyz";
export type LiatirStructureStyle = "cartoon" | "stick" | "line" | "sphere";

export interface LiatirStructureViewerSection {
  type: "structure-viewer";
  label: string;
  description?: string;
  path?: string;
  content?: string;
  format: LiatirStructureFormat;
  style?: LiatirStructureStyle;
  colorScheme?: "spectrum" | "chain" | "element";
  height?: number;
}

export type LiatirGenomeTrackKind =
  | "gff"
  | "bed"
  | "vcf"
  | "bam"
  | "wiggle"
  | "unknown";

export interface LiatirGenomeAssemblySpec {
  name: string;
  fastaPath?: string;
  fastaUrl?: string;
  faiPath?: string;
  faiUrl?: string;
  refName?: string;
  start?: number;
  end?: number;
}

export interface LiatirGenomeTrackSpec {
  name: string;
  kind: LiatirGenomeTrackKind;
  path?: string;
  url?: string;
  indexPath?: string;
  indexUrl?: string;
  category?: string;
}

export interface LiatirGenomeViewerSection {
  type: "genome-viewer";
  label: string;
  description?: string;
  assembly: LiatirGenomeAssemblySpec;
  tracks: LiatirGenomeTrackSpec[];
  height?: number;
}

export interface LiatirSingleCellViewerSection {
  type: "single-cell-viewer";
  label: string;
  description?: string;
  config: JsonValue;
  height?: number;
}

export type LiatirToolSection =
  | LiatirStatsSection
  | LiatirNumberSection
  | LiatirPlotlySection
  | LiatirTextSection
  | LiatirTableSection
  | LiatirStructureViewerSection
  | LiatirGenomeViewerSection
  | LiatirSingleCellViewerSection;

export interface LiatirToolOutput {
  sections: LiatirToolSection[];
}

export interface LiatirExecutionResult {
  outputFiles: LiatirFileArtifact[];
  output?: LiatirToolOutput;
  metrics?: Record<string, number>;
  values?: Record<string, JsonValue>;
  logs?: string[];
}

export type LiatirAIModelRuntimeKind =
  | "mock"
  | "python-venv"
  | "llama-cpp"
  | "onnx"
  | "transformers-js"
  | "custom";
export type LiatirAIModelSource =
  | "builtin"
  | "local-file"
  | "local-directory"
  | "managed-download"
  | "managed-runtime";
export type LiatirAIModelStatus =
  | "available"
  | "installed"
  | "missing"
  | "error";
export type LiatirAICapability =
  | "text-generation"
  | "summarization"
  | "classification"
  | "cell-annotation"
  | "single-cell-embedding"
  | "batch-correction"
  | "perturbation-prediction"
  | "gene-network-inference"
  | "embedding"
  | "sequence-embedding"
  | "regulatory-prediction"
  | "variant-effect-scoring"
  | "protein-structure-prediction"
  | "protein-binding"
  | "reranking"
  | "structured-extraction";
export type LiatirAIModelModality =
  | "text"
  | "dna"
  | "rna"
  | "protein"
  | "ligand"
  | "single-cell"
  | "image"
  | "multimodal";

export interface LiatirAIModelRuntime {
  kind: LiatirAIModelRuntimeKind;
  name: string;
  version?: string;
}

export interface LiatirAIModelLicense {
  name: string;
  spdxId?: string;
  url?: string;
  /** ISO date when license metadata was verified from an official source. */
  verifiedAt?: string;
}

export interface LiatirAIModelHardwareRequirements {
  cpu?: boolean;
  gpu?: boolean;
  minRamGb?: number;
  recommendedRamGb?: number;
  minVramGb?: number;
  recommendedVramGb?: number;
  notes?: string;
}

export interface LiatirAIModelInstallSpec {
  method: LiatirAIModelSource;
  path?: string;
  urls?: string[];
  files?: LiatirAIModelInstallFile[];
  runtimeId?: string;
  runtimePackages?: LiatirAIModelRuntimePackage[];
  runtimeSources?: LiatirAIModelRuntimeSource[];
  modelCacheSubdir?: string;
  /** Immutable upstream model/source revision, when the runtime downloads from a versioned hub. */
  revision?: string;
  hostRequirements?: LiatirAIModelHostRequirements;
  checksum?: string;
}

export interface LiatirAIModelInstallFile {
  url: string;
  relativePath: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface LiatirAIModelRuntimePackage {
  package: LiatirPythonRuntimePackage["package"];
  version?: LiatirPythonRuntimePackage["version"];
  specifier?: LiatirPythonRuntimePackage["specifier"];
  importName?: LiatirPythonRuntimePackage["importName"];
  installOptions?: LiatirPythonRuntimePackageInstallOptions;
}

export interface LiatirAIModelRuntimePackageInstallOptions extends LiatirPythonRuntimePackageInstallOptions {}

export interface LiatirPythonRuntimeLockedPackage {
  package: string;
  importName?: string;
  specifier?: string;
  requested: string;
  installedVersion?: string;
}

export interface LiatirPythonRuntimeLockedSource {
  url: string;
  revision?: string;
  relativePath: string;
  pythonPath: boolean;
  resolvedRevision?: string;
}

export interface LiatirPythonRuntimeLock {
  schemaVersion: number;
  envRoot: string;
  envId: string;
  pythonVersion?: string;
  installer: string;
  requirements: string[];
  packages: LiatirPythonRuntimeLockedPackage[];
  sources: LiatirPythonRuntimeLockedSource[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface LiatirAIModelRuntimeSource {
  url: string;
  revision?: string;
  relativePath: string;
  pythonPath?: boolean;
}

export interface LiatirAIModelPythonRequirement extends LiatirPythonRequirement {}

export interface LiatirAIModelHostRequirements {
  os?: string[];
  requiresCuda?: boolean;
  python?: LiatirAIModelPythonRequirement;
  reason?: string;
}

export interface LiatirAIModelDocumentation {
  /** Public Liatir documentation path, relative to the configured documentation base URL. */
  liatirPath?: string;
  /** Official upstream model, package, or project page. */
  officialUrl?: string;
  paperUrl?: string;
}

export type LiatirAIModelCatalogVisibility = "visible" | "hidden";
export type LiatirAIModelReleaseStage = "ready" | "preview";

export interface LiatirAIModelMetadata {
  id: string;
  name: string;
  description: string;
  /** Product-facing model family/category used for registry grouping. */
  category: string;
  version?: string;
  runtime: LiatirAIModelRuntime;
  source: LiatirAIModelSource;
  localOnly: boolean;
  capabilities: LiatirAICapability[];
  modalities: LiatirAIModelModality[];
  parameters?: number;
  quantization?: string;
  contextWindow?: number;
  diskSizeBytes?: number;
  license?: LiatirAIModelLicense;
  hardware?: LiatirAIModelHardwareRequirements;
  install?: LiatirAIModelInstallSpec;
  documentation?: LiatirAIModelDocumentation;
  /** Preview models are visible for roadmap/docs but are not installable or runnable yet. */
  releaseStage?: LiatirAIModelReleaseStage;
  /** Hidden models remain implemented but are not exposed in normal product surfaces. */
  catalogVisibility?: LiatirAIModelCatalogVisibility;
  catalogHiddenReason?: string;
  tags?: string[];
}

export interface LiatirAIModelRecord extends LiatirAIModelMetadata {
  status: LiatirAIModelStatus;
  localPath?: string;
  runtimePath?: string;
  cachePath?: string;
  /** Current bytes used by the installed runtime/model box when measured locally. */
  installedSizeBytes?: number;
  /** Bytes used by the Python/runtime environment box, when measured locally. */
  runtimeSizeBytes?: number;
  /** Bytes used by model cache/weights inside the runtime box, when measured separately. */
  cacheSizeBytes?: number;
  /** Runtime dependency lock captured after preparation/install. */
  runtimeLock?: LiatirPythonRuntimeLock;
  enabled?: boolean;
  addedAt?: number;
  updatedAt?: number;
  error?: string;
}

export interface LiatirAIToolDefinition extends LiatirStepDefinition {
  type: "ai-tool";
  modelInputKey?: string;
  supportedCapabilities?: LiatirAICapability[];
  /** Optional exact allow-list when capabilities are too broad for backend compatibility. */
  supportedModelIds?: string[];
}

export interface LiatirAIProvenance {
  toolId: string;
  toolLabel: string;
  modelId: string;
  modelName: string;
  modelVersion?: string | null;
  runtimeKind: LiatirAIModelRuntimeKind;
  runtimeName: string;
  runtimeVersion?: string | null;
  runtimeLock?: LiatirPythonRuntimeLock | null;
  localOnly: boolean;
  inputSummary?: Record<string, JsonValue>;
  parameters?: Record<string, JsonValue>;
  generatedAt: string;
}

// Compatibility aliases used by the current frontend and packages.
export type InputFieldSchema = LiatirInputFieldSchema;
export type OutputFieldSchema = LiatirOutputFieldSchema;
export type PipelineStepDefinition = LiatirStepDefinition;
export type RunOutputFile = LiatirFileArtifact;
export type FileOutputValue = LiatirFileOutputValue;
export type StepStatus = LiatirStepStatus;

export type StatItem = LiatirStatItem;
export type StatsSection = LiatirStatsSection;
export type NumberSection = LiatirNumberSection;
export type PlotlySection = LiatirPlotlySection;
export type TextSection = LiatirTextSection;
export type TableSection = LiatirTableSection;
export type StructureViewerSection = LiatirStructureViewerSection;
export type GenomeViewerSection = LiatirGenomeViewerSection;
export type SingleCellViewerSection = LiatirSingleCellViewerSection;
export type ToolSection = LiatirToolSection;
export type ToolOutput = LiatirToolOutput;

// Built-in AI model catalog — the single source of truth shared by the app UI
// and the plugin API (@liatir/api Liatir.ai). Model ids, metadata, and runtime
// specs live here so neither side hand-duplicates the list.
export * from "./ai-catalog";

// Built-in native tools catalog — bioinformatics binaries bundled with Liatir.
export * from "./native-tools";

// ── ToolRef — unified reference for anything spawnable via jobs ──────────────

/**
 * Kind of runnable entity that can be spawned via `jobs.spawn()`.
 */
export type LiatirRunnableKind =
  | "native-tool"
  | "ai-model"
  | "lia-plugin"
  | "api-request";

/**
 * A typed reference to a runnable entity. Used by `jobs.spawn()` to resolve
 * the correct binary, runtime, or plugin entry point.
 */
export interface LiatirToolRef {
  readonly __kind: LiatirRunnableKind;
  readonly id: string;
}

/** Create a ToolRef for a bundled native tool. */
export function nativeTool(id: string): LiatirToolRef {
  return { __kind: "native-tool", id };
}

/** Create a ToolRef for an AI model. */
export function aiModel(id: string): LiatirToolRef {
  return { __kind: "ai-model", id };
}

/** Create a ToolRef for a .lia plugin. */
export function liaPlugin(id: string): LiatirToolRef {
  return { __kind: "lia-plugin", id };
}

/** Create a ToolRef for an API request endpoint. */
export function apiRequest(id: string): LiatirToolRef {
  return { __kind: "api-request", id };
}

// ── Plugin Log & Progress — contracts for plugin observability ───────────────

/**
 * Log level for structured plugin logs.
 */
export type LiatirLogLevel = "info" | "warn" | "error" | "debug";

/**
 * A structured log entry emitted by a plugin during execution.
 */
export interface LiatirPluginLogEntry {
  jobId: string;
  level: LiatirLogLevel;
  message: string;
  meta?: Record<string, JsonValue>;
  timestampMs: number;
}

/**
 * Progress state for a running job, updated by the plugin via the progress API.
 */
export interface LiatirJobProgress {
  current: number;
  total?: number;
  label?: string;
  done: boolean;
}

// Read-only local Tutor contracts. The Tutor may explain app/scientific state
// and generate cited reports, but it is intentionally not a runnable entity.
export * from "./tutor";
