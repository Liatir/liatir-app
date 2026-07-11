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

export interface LiatirQuentaGenerationTrace {
  reasoning?: string;
  durationMs?: number;
  reasoningDurationMs?: number;
  contextDocumentCount?: number;
  sourceCount?: number;
  reportRepairAttempted?: boolean;
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
  generation?: LiatirQuentaGenerationTrace;
}

export interface LiatirQuentaConversation {
  id: string;
  workspaceId: string;
  title: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  focus?: LiatirQuentaFocus;
  draft?: string;
  draftIntent?: LiatirQuentaIntent;
  messages: LiatirQuentaMessage[];
}

export interface LiatirQuentaProviderConfig {
  provider: LiatirQuentaProviderKind;
  baseUrl: string;
  model: string;
  embeddingModel?: string;
  temperature: number;
  thinkingEnabled?: boolean;
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
  thinkingEnabled?: boolean;
  format?: JsonValue;
}

export interface LiatirQuentaChatResponse {
  model: string;
  content: string;
  thinking?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalDurationNs?: number;
}

export type LiatirQuentaChatRequestStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** App-owned Quenta request state used to reconnect after page navigation or reload. */
export interface LiatirQuentaChatRequestSnapshot {
  requestId: string;
  status: LiatirQuentaChatRequestStatus;
  model: string;
  thinking: string;
  content: string;
  response?: LiatirQuentaChatResponse;
  error?: string;
  updatedAt: number;
}

export type LiatirQuentaStreamEventKind = "thinking-delta" | "content-delta";

export interface LiatirQuentaStreamEvent {
  type: LiatirQuentaStreamEventKind;
  delta: string;
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
