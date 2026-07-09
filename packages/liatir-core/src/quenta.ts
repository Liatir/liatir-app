import type { JsonValue, LiatirRunStatus } from "./index";

export type LiatirQuentaProviderKind = "ollama";
export type LiatirQuentaRole = "user" | "assistant";
export type LiatirQuentaIntent =
  | "chat"
  | "explain-result"
  | "explain-failure"
  | "report";

export type LiatirQuentaSourceKind =
  | "app"
  | "documentation"
  | "bioinformatics"
  | "workspace"
  | "pipeline"
  | "result"
  | "job"
  | "ai-model"
  | "api-connector";

export interface LiatirQuentaCitation {
  id: string;
  sourceKind: LiatirQuentaSourceKind;
  title: string;
  locator: string;
  excerpt?: string;
}

export interface LiatirQuentaContextDocument extends LiatirQuentaCitation {
  content: string;
  updatedAt?: number;
}

export interface LiatirQuentaFocus {
  kind: "result" | "job";
  entityId: string;
}

export interface LiatirQuentaMessage {
  id: string;
  role: LiatirQuentaRole;
  intent: LiatirQuentaIntent;
  content: string;
  createdAt: number;
  citations?: LiatirQuentaCitation[];
  model?: string;
  report?: LiatirQuentaReport;
}

export interface LiatirQuentaConversation {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  focus?: LiatirQuentaFocus;
  messages: LiatirQuentaMessage[];
}

export interface LiatirQuentaProviderConfig {
  provider: LiatirQuentaProviderKind;
  baseUrl: string;
  model: string;
  embeddingModel?: string;
  temperature: number;
}

export interface LiatirQuentaProviderModel {
  name: string;
  modifiedAt?: string;
  sizeBytes?: number;
  digest?: string;
  family?: string;
  parameterSize?: string;
  quantization?: string;
}

export interface LiatirQuentaProviderStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export interface LiatirQuentaRuntimeMessage {
  role: "system" | LiatirQuentaRole;
  content: string;
}

export interface LiatirQuentaChatRequest {
  model: string;
  messages: LiatirQuentaRuntimeMessage[];
  temperature: number;
  format?: JsonValue;
}

export interface LiatirQuentaChatResponse {
  model: string;
  content: string;
  promptTokens?: number;
  completionTokens?: number;
  totalDurationNs?: number;
}

export interface LiatirQuentaReportFinding {
  title: string;
  interpretation: string;
  evidence: string[];
  citationIds: string[];
}

export interface LiatirQuentaReport {
  title: string;
  generatedAt: string;
  subject: string;
  runStatus?: LiatirRunStatus;
  executiveSummary: string;
  methods: string[];
  findings: LiatirQuentaReportFinding[];
  limitations: string[];
  recommendedNextSteps: string[];
  citationIds: string[];
}
