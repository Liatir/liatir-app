import type { JsonValue, LiatirRunStatus } from "./index";

export type LiatirTutorProviderKind = "ollama";
export type LiatirTutorRole = "user" | "assistant";
export type LiatirTutorIntent =
  | "chat"
  | "explain-result"
  | "explain-failure"
  | "report";

export type LiatirTutorSourceKind =
  | "app"
  | "documentation"
  | "bioinformatics"
  | "workspace"
  | "pipeline"
  | "result"
  | "job"
  | "ai-model"
  | "api-connector";

export interface LiatirTutorCitation {
  id: string;
  sourceKind: LiatirTutorSourceKind;
  title: string;
  locator: string;
  excerpt?: string;
}

export interface LiatirTutorContextDocument extends LiatirTutorCitation {
  content: string;
  updatedAt?: number;
}

export interface LiatirTutorFocus {
  kind: "result" | "job";
  entityId: string;
}

export interface LiatirTutorMessage {
  id: string;
  role: LiatirTutorRole;
  intent: LiatirTutorIntent;
  content: string;
  createdAt: number;
  citations?: LiatirTutorCitation[];
  model?: string;
  report?: LiatirTutorReport;
}

export interface LiatirTutorConversation {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  focus?: LiatirTutorFocus;
  messages: LiatirTutorMessage[];
}

export interface LiatirTutorProviderConfig {
  provider: LiatirTutorProviderKind;
  baseUrl: string;
  model: string;
  embeddingModel?: string;
  temperature: number;
}

export interface LiatirTutorProviderModel {
  name: string;
  modifiedAt?: string;
  sizeBytes?: number;
  digest?: string;
  family?: string;
  parameterSize?: string;
  quantization?: string;
}

export interface LiatirTutorProviderStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export interface LiatirTutorRuntimeMessage {
  role: "system" | LiatirTutorRole;
  content: string;
}

export interface LiatirTutorChatRequest {
  model: string;
  messages: LiatirTutorRuntimeMessage[];
  temperature: number;
  format?: JsonValue;
}

export interface LiatirTutorChatResponse {
  model: string;
  content: string;
  promptTokens?: number;
  completionTokens?: number;
  totalDurationNs?: number;
}

export interface LiatirTutorReportFinding {
  title: string;
  interpretation: string;
  evidence: string[];
  citationIds: string[];
}

export interface LiatirTutorReport {
  title: string;
  generatedAt: string;
  subject: string;
  runStatus?: LiatirRunStatus;
  executiveSummary: string;
  methods: string[];
  findings: LiatirTutorReportFinding[];
  limitations: string[];
  recommendedNextSteps: string[];
  citationIds: string[];
}
