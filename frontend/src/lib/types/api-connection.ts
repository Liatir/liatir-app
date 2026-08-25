import type {
  LiatirApiFieldType,
  LiatirApiOutputSchemaField,
  LiatirApiParameter,
  LiatirHttpMethod,
  LiatirHttpResponse,
} from '@liatir/core';

export interface ApiKeyValue {
  key: string;
  value: string;
  enabled: boolean;
}

export type ApiParam = LiatirApiParameter;
export type HttpMethod = LiatirHttpMethod;
export type BodyType = 'none' | 'json' | 'raw' | 'form-urlencoded';

export type AuthType =
  | 'none'
  | 'inherit'
  | 'basic'
  | 'bearer'
  | 'api-key-header'
  | 'api-key-query'
  | 'oauth2-password'
  | 'oauth2-custom'
  | 'jwt';

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

  // API key — keyName is the header or query parameter name.
  keyName?: string;
  keyValue?: string;

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

export type ApiFieldType = LiatirApiFieldType;
export type ApiOutputSchemaField = LiatirApiOutputSchemaField;

export interface ApiRequest {
  id: string;
  collectionId: string;
  name: string;
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

/** Shared authentication, headers and parameters applied to a group of related calls. */
export interface ApiCollection {
  id: string;
  name: string;
  auth: ApiAuth;
  sharedHeaders: ApiKeyValue[];
  sharedParams: ApiParam[];
  createdAt: number;
}

export type ApiResponse = LiatirHttpResponse;

// Legacy alias
export type ApiConnection = ApiRequest;

export const DEFAULT_REQUEST: Omit<ApiRequest, 'id' | 'collectionId' | 'createdAt' | 'updatedAt'> = {
  name: 'New call',
  method: 'GET',
  url: '',
  params: [],
  headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
  body: { type: 'none', content: '' },
  auth: { type: 'inherit' },
};

/** Default param row factory. */
export function emptyParam(): ApiParam {
  return {
    key: '',
    value: '',
    source: 'manual',
    exposedAsInput: true,
    required: true,
    enabled: true,
  };
}
