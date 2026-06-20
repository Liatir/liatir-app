export interface ApiKeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type BodyType = 'none' | 'json' | 'raw' | 'form-data';
export type AuthType = 'none' | 'bearer' | 'basic' | 'api-key';

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
}

export interface ApiCollection {
  id: string;
  name: string;
  createdAt: number;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

// Legacy alias kept for any code that imports ApiConnection
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
