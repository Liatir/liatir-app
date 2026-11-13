import type { JsonValue } from "./index";

export type LiatirQuentaProviderKind = "ollama";
export type LiatirQuentaRole = "user" | "assistant";
export type LiatirQuentaIntent =
  | "chat"
  | "explain-result"
  | "explain-failure";

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
}

export interface LiatirQuentaMessage {
  id: string;
  role: LiatirQuentaRole;
  intent: LiatirQuentaIntent;
  content: string;
  createdAt: number;
  citations?: LiatirQuentaCitation[];
  model?: string;
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
  /** Longest answer allowed, in tokens; presentations need more room than a chat reply. */
  maxOutputTokens?: number;
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

/**
 * Explicit local download choices, independent of scientific AI Model assets. Standard stays on
 * qwen3.5:9b: measured on a 16 GB Mac against gemma4:12b, answers were of similar quality while it
 * took 6.2 GB instead of 9.6 GB and wrote about 9 rather than 5 tokens per second. Both profiles use
 * Quenta's single context window (`LIATIR_QUENTA_CONTEXT_TOKENS`).
 */
export const LIATIR_QUENTA_LOCAL_PROFILES = [
  { id: '16gb', label: 'Standard', memoryGb: 16, name: 'Qwen 3.5 9B', model: 'qwen3.5:9b', downloadGb: 6.6 },
  { id: '32gb', label: 'Extended', memoryGb: 32, name: 'Qwen 3.8 27B', model: 'qwen3.8:27b', downloadGb: 17.7 },
] as const;

/**
 * The context window (tokens) every Quenta request asks Ollama for, as the native bridge sends it.
 * A full request — system prompt, retrieved sources, recent history and the answer — is sized for it.
 */
export const LIATIR_QUENTA_CONTEXT_TOKENS = 16384;

export interface LiatirQuentaPresentationSource {
  resultId: string;
  label: string;
  tool: string;
  endedAt: number;
  output: JsonValue;
}

/**
 * What Quenta builds on the Stage, saved as a Result: frozen evidence and the generated page. Named
 * "presentation" in stored data and code; users see it as a Stage page. Rendering has no authority
 * over the app.
 */
export interface LiatirQuentaPresentation {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  model: string;
  sources: LiatirQuentaPresentationSource[];
  /**
   * The Stage page as a document (the model fills in data, it writes no code). Its format belongs to
   * the runtime named by `runtimeId`, which draws it; a later runtime never has to read an older page.
   */
  page?: JsonValue;
  /** Generated page code. Only in presentations made before Stage pages; never generated any more. */
  javascript?: string;
  css?: string;
  /**
   * The frame runtime (React, the Stage kit, Tailwind) as script text. Embedded by presentations made
   * before the runtime was stored once; newer ones name it with `runtimeId` instead.
   */
  runtimeSource?: string;
  /** SHA-256 (hex) of the stored runtime script this presentation was made with. */
  runtimeId?: string;
}
