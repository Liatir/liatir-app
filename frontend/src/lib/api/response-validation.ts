import type { ApiRequest, ApiResponse } from '$lib/types/api-connection';
import type { ApiOutputSchemaField } from '$lib/types/api-connection';

export type ApiConnectorErrorKind =
  | 'authentication'
  | 'malformed-response'
  | 'rate-limit'
  | 'http'
  | 'network';

/** Structured failure retained by direct and pipeline API Connector runs. */
export class ApiConnectorError extends Error {
  constructor(
    readonly kind: ApiConnectorErrorKind,
    message: string,
    readonly response?: ApiResponse,
  ) {
    super(message);
    this.name = 'ApiConnectorError';
  }
}

function valueAtPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let current = value;
  for (const part of path.replace(/^\$\./, '').split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function flattenSchema(
  schema: Record<string, ApiOutputSchemaField>,
  prefix = '',
): { key: string; field: ApiOutputSchemaField }[] {
  return Object.entries(schema).flatMap(([key, field]) => {
    const outputKey = prefix ? `${prefix}.${key}` : key;
    return field.type === 'object' && field.children
      ? flattenSchema(field.children, outputKey)
      : [{ key: outputKey, field }];
  });
}

export function validateApiConnectorResponse(req: ApiRequest, response: ApiResponse): void {
  if (response.status === 429) {
    const retryAfter = response.headers['retry-after'];
    throw new ApiConnectorError(
      'rate-limit',
      `API rate limit reached (HTTP 429)${retryAfter ? `; retry after ${retryAfter}` : ''}.`,
      response,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ApiConnectorError(
      'http',
      `API request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
      response,
    );
  }

  const schema = req.outputSchema;
  if (!schema || Object.keys(schema).length === 0) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new ApiConnectorError(
      'malformed-response',
      'API response is not valid JSON but this Connector declares structured outputs.',
      response,
    );
  }
  const fields = flattenSchema(schema);
  const missing = fields
    .filter(({ field }) => valueAtPath(parsed, field.path) === undefined)
    .map(({ key }) => key);
  if (missing.length > 0) {
    throw new ApiConnectorError(
      'malformed-response',
      `API response is missing declared output${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
      response,
    );
  }

  const wrongTypes = fields.flatMap(({ key, field }) => {
    const value = valueAtPath(parsed, field.path);
    return matchesDeclaredType(value, field) ? [] : [key];
  });
  if (wrongTypes.length > 0) {
    throw new ApiConnectorError(
      'malformed-response',
      `API response has the wrong type for declared output${wrongTypes.length === 1 ? '' : 's'}: ${wrongTypes.join(', ')}.`,
      response,
    );
  }
}

function matchesDeclaredType(value: unknown, field: ApiOutputSchemaField): boolean {
  switch (field.type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'date': return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
  }
}

export function parseOAuthTokenResponse(
  response: ApiResponse,
  tokenPath: string,
): { token: string; expiresIn: number } {
  if (response.status < 200 || response.status >= 300) {
    throw new ApiConnectorError(
      'authentication',
      `OAuth token request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`,
      response,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new ApiConnectorError('authentication', 'OAuth token response is not valid JSON.', response);
  }
  const token = valueAtPath(parsed, tokenPath);
  if (typeof token !== 'string' || !token.trim()) {
    throw new ApiConnectorError(
      'authentication',
      `OAuth token response does not contain a token at "${tokenPath}".`,
      response,
    );
  }
  const expiresRaw = parsed && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>).expires_in
    : undefined;
  const expiresIn = Number(expiresRaw ?? 3600);
  return { token, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600 };
}
