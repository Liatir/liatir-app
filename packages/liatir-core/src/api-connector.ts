/** HTTP methods supported by saved API Connector requests. */
export type LiatirHttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface LiatirHttpRequest {
  requestId: string;
  method: LiatirHttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface LiatirHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

export interface LiatirApiParameter {
  key: string;
  value: string;
  /** Template parameters follow their URL, header or body placeholder; manual rows do not. */
  source?: "manual" | "template";
  /** Whether a run may supply a value instead of the saved default. */
  exposedAsInput: boolean;
  required: boolean;
  enabled: boolean;
}

export type LiatirApiFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "object"
  | "array";

export interface LiatirApiOutputSchemaField {
  label: string;
  path: string;
  type: LiatirApiFieldType;
  children?: Record<string, LiatirApiOutputSchemaField>;
  items?: LiatirApiOutputSchemaField;
}
