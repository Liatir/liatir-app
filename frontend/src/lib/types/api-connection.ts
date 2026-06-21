export interface ApiKeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

/**
 * A Bubble-style call parameter. Beyond a plain key/value it carries:
 * - `private`:    value is fixed server-side and NOT exposed as an input
 *                 (non-private params become call-time inputs / pipeline node inputs).
 * - `querystring`: sent as a URL query param when true, otherwise part of the body.
 * - `optional`:   may be left blank.
 * Parameters are also referenced inline via `[key]` in the URL/headers and `<key>` in the body.
 */
export interface ApiParam {
  key: string;
  value: string;
  private: boolean;
  querystring: boolean;
  optional: boolean;
  enabled: boolean;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type BodyType = 'none' | 'json' | 'raw' | 'form-data';

/** Bubble.io authentication set. `oauth2-user-agent` is reserved for phase 2 (disabled in UI). */
export type AuthType =
  | 'none'
  | 'inherit'              // call inherits the provider-level auth
  | 'basic'                // HTTP Basic Auth
  | 'bearer'               // Bearer token
  | 'api-key'              // private key in header
  | 'api-key-url'          // private key in URL (query string)
  | 'private-key-header'   // alias of api-key (Bubble naming)
  | 'private-key-url'      // alias of api-key-url (Bubble naming)
  | 'oauth2-password'      // OAuth2 Password flow
  | 'oauth2-custom'        // OAuth2 Custom Token (user-defined token request)
  | 'jwt'                  // signed JWT (HS*)
  | 'oauth2-user-agent';   // OAuth2 User-Agent redirect flow — PHASE 2 (UI disabled)

export interface ApiBody {
  type: BodyType;
  content: string;
}

export interface ApiAuth {
  type: AuthType;

  // bearer
  token?: string;

  // basic
  username?: string;
  password?: string;

  // key-based (api-key / private-key, header or url) — keyName is the header/query param name
  keyName?: string;
  keyValue?: string;
  // legacy fields kept for back-compat with existing api-workspace.json
  apiKeyHeader?: string;
  apiKeyValue?: string;

  // oauth2 (password / custom)
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  headerPrefix?: string;   // default 'Bearer'
  tokenPath?: string;      // dot-path to the token in the token response (default 'access_token')
  customTokenRequest?: {   // oauth2-custom: fully user-defined token request
    method: HttpMethod;
    url: string;
    headers: ApiKeyValue[];
    body: ApiBody;
  };

  // jwt (HS256/384/512 via WebCrypto)
  jwtSecret?: string;
  jwtAlg?: 'HS256' | 'HS384' | 'HS512';
  jwtPayload?: string;     // JSON payload template
}

export type ApiFieldType = 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';

/** A typed return value. Recursive: objects carry `children`, arrays carry `items`. */
export interface ApiOutputSchemaField {
  label: string;
  path: string;            // dot-path to the value (used by the pipeline to extract leaves)
  type: ApiFieldType;
  children?: Record<string, ApiOutputSchemaField>;  // when type === 'object'
  items?: ApiOutputSchemaField;                      // when type === 'array'
}

export interface ApiRequest {
  id: string;
  collectionId: string;
  name: string;
  useAs: 'action' | 'data';
  method: HttpMethod;
  url: string;
  params: ApiParam[];
  headers: ApiKeyValue[];
  body: ApiBody;
  auth: ApiAuth;
  createdAt: number;
  updatedAt: number;
  outputSchema?: Record<string, ApiOutputSchemaField>;
  lastResponse?: {
    status: number;
    statusText: string;
    body: string;
    headers: Record<string, string>;
    durationMs: number;
    timestamp: number;
  };
}

/** A Bubble "API" provider: shared auth + shared headers/params applied to all its calls. */
export interface ApiCollection {
  id: string;
  name: string;
  auth: ApiAuth;
  sharedHeaders: ApiKeyValue[];
  sharedParams: ApiParam[];
  createdAt: number;
}

export interface ApiEnvironmentVar {
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiEnvironment {
  id: string;
  name: string;
  variables: ApiEnvironmentVar[];
  createdAt: number;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

// Legacy alias
export type ApiConnection = ApiRequest;

export const DEFAULT_REQUEST: Omit<ApiRequest, 'id' | 'collectionId' | 'createdAt' | 'updatedAt'> = {
  name: 'New call',
  useAs: 'data',
  method: 'GET',
  url: '',
  params: [],
  headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
  body: { type: 'none', content: '' },
  auth: { type: 'inherit' },
};

/** Default param row factory. */
export function emptyParam(): ApiParam {
  return { key: '', value: '', private: false, querystring: true, optional: false, enabled: true };
}
