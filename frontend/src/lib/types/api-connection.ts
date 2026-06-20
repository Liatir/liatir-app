export interface ApiKeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
export type BodyType = 'none' | 'json' | 'form-data' | 'raw';
export type AuthType = 'none' | 'bearer' | 'basic';

export interface ApiBody {
  type: BodyType;
  content: string;
}

export interface ApiAuth {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
}

export interface ApiConnection {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: ApiKeyValue[];
  headers: ApiKeyValue[];
  body: ApiBody;
  auth: ApiAuth;
  responseSchema?: Record<string, { type: string; path: string; label?: string }>;
  createdAt: number;
  updatedAt: number;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

export const DEFAULT_CONNECTION: Omit<ApiConnection, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'New Request',
  method: 'GET',
  url: '',
  params: [],
  headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
  body: { type: 'none', content: '' },
  auth: { type: 'none' },
};
