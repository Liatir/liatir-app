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

export type LiatirApiParameterLocation = "query" | "body";

export interface LiatirApiParameter {
  key: string;
  value: string;
  /** Whether a run may supply a value instead of the saved default. */
  exposedAsInput: boolean;
  /** Used only when the parameter is not already embedded in a request template. */
  location: LiatirApiParameterLocation;
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
