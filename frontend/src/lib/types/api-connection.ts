export interface ApiKeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type BodyType = 'none' | 'json' | 'raw' | 'form-data';
export type AuthType = 'none' | 'bearer' | 'basic' | 'api-key' | 'inherit';

export interface ApiBody {
  type: BodyType;
  content: string;
}

export interface ApiAuth {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  apiKeyHeader?: string;
  apiKeyValue?: string;
}

export interface ApiOutputSchemaField {
  label: string;
  path: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
}

export interface ApiRequest {
  id: string;
  collectionId: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: ApiKeyValue[];
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

export interface ApiCollection {
  id: string;
  name: string;
  auth: ApiAuth;
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
  name: 'New Request',
  method: 'GET',
  url: '',
  params: [],
  headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
  body: { type: 'none', content: '' },
  auth: { type: 'none' },
};
