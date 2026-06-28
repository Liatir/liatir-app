// @liatir/core
//
// Global Liatir contracts shared by every executable node type:
// native tools, Node .lia plugins, WASM .lia tools, API calls, future AI tools,
// utility nodes, and sub-pipelines.
//
// This package is the single source of truth for schema and result shapes.
// UI components, the SDK, the CLI, parsers, and pipeline code should import or
// re-export these types instead of mirroring them manually.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type LiatirInputFieldType = 'string' | 'number' | 'boolean' | 'file';
export type LiatirOutputFieldType = 'string' | 'number' | 'boolean' | 'file' | 'stats' | 'json';
export type LiatirFieldType = LiatirInputFieldType | LiatirOutputFieldType;

export type LiatirStepKind =
  | 'native-tool'
  | 'lia-plugin'
  | 'wasm-plugin'
  | 'api-request'
  | 'ai-tool'
  | 'utility'
  | 'sub-pipeline';

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
}

export interface LiatirInputFieldSchema<TDefault = unknown> extends LiatirFieldSchema<TDefault> {
  type: LiatirInputFieldType;
}

export interface LiatirOutputFieldSchema extends LiatirFieldSchema {
  type: LiatirOutputFieldType;
  /** Expected extensions for file outputs. Kept for pipeline-port readability. */
  ext?: string[];
  /** Display hint for numeric metric outputs. */
  format?: 'integer' | 'decimal' | 'percent' | 'bytes';
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

export interface LiatirFileArtifact {
  label: string;
  path: string;
  ext: string;
  size?: number;
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
export type LiatirFileOutputValue = string | LiatirFilePathOutput | LiatirFileContentOutput;

export type LiatirOutputValue = JsonValue | LiatirFileOutputValue;

export type LiatirStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface LiatirStatItem {
  label: string;
  value: string | number;
  color?: string;
  description?: string;
}

export interface LiatirStatsSection {
  type: 'stats';
  cols?: number;
  items: LiatirStatItem[];
}

export interface LiatirNumberSection {
  type: 'number';
  label: string;
  value: number;
  unit?: string;
  color?: string;
  format?: 'integer' | 'decimal' | 'percent' | 'bytes';
  description?: string;
}

export interface LiatirPlotlySection {
  type: 'plotly';
  plotlyType: string;
  title?: string;
  subtitle?: string;
  description?: string;
  data: object[];
  layout?: object;
}

export interface LiatirTextSection {
  type: 'text';
  label: string;
  content: string;
  mono?: boolean;
  description?: string;
  /** Raw command stdout/stderr dump; redundant with logs and skipped in exports. */
  raw?: boolean;
}

export interface LiatirTableSection {
  type: 'table';
  label: string;
  headers: string[];
  rows: (string | number)[][];
}

export type LiatirToolSection =
  | LiatirStatsSection
  | LiatirNumberSection
  | LiatirPlotlySection
  | LiatirTextSection
  | LiatirTableSection;

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

export type LiatirAIModelRuntimeKind = 'mock' | 'llama-cpp' | 'onnx' | 'custom';
export type LiatirAIModelSource = 'builtin' | 'local-file' | 'local-directory' | 'managed-download';
export type LiatirAIModelStatus = 'available' | 'installed' | 'missing' | 'error';
export type LiatirAICapability =
  | 'text-generation'
  | 'summarization'
  | 'classification'
  | 'embedding'
  | 'reranking'
  | 'structured-extraction';
export type LiatirAIModelModality = 'text' | 'dna' | 'rna' | 'protein' | 'image' | 'multimodal';

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
  checksum?: string;
}

export interface LiatirAIModelMetadata {
  id: string;
  name: string;
  description: string;
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
  tags?: string[];
}

export interface LiatirAIModelRecord extends LiatirAIModelMetadata {
  status: LiatirAIModelStatus;
  localPath?: string;
  enabled?: boolean;
  isDefault?: boolean;
  addedAt?: number;
  updatedAt?: number;
  error?: string;
}

export interface LiatirAIToolDefinition extends LiatirStepDefinition {
  type: 'ai-tool';
  modelInputKey?: string;
  supportedCapabilities?: LiatirAICapability[];
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
export type ToolSection = LiatirToolSection;
export type ToolOutput = LiatirToolOutput;
