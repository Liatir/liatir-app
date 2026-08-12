import { describe, expect, it } from 'vitest';

import type { ApiRequest, ApiResponse } from '../../frontend/src/lib/types/api-connection';
import {
  ApiConnectorError,
  parseOAuthTokenResponse,
  validateApiConnectorResponse,
} from '../../frontend/src/lib/api/response-validation';

const request = {
  id: 'request', collectionId: 'collection', name: 'Call', useAs: 'data', method: 'GET',
  url: 'https://example.test', params: [], headers: [], body: { type: 'none', content: '' },
  auth: { type: 'none' }, createdAt: 1, updatedAt: 1,
} satisfies ApiRequest;

function response(status: number, body: string, headers: Record<string, string> = {}): ApiResponse {
  return { status, statusText: status === 200 ? 'OK' : 'Error', headers, body, durationMs: 1 };
}

describe('API Connector response contract', () => {
  it('classifies rate limits with retry guidance', () => {
    expect(() => validateApiConnectorResponse(request, response(429, '{}', { 'retry-after': '30' })))
      .toThrowError(expect.objectContaining<ApiConnectorError>({ kind: 'rate-limit' }));
  });

  it('rejects malformed and incomplete declared structured outputs', () => {
    const structured = {
      ...request,
      outputSchema: { id: { label: 'ID', path: 'data.id', type: 'string' as const } },
    };
    expect(() => validateApiConnectorResponse(structured, response(200, 'not-json')))
      .toThrowError(expect.objectContaining<ApiConnectorError>({ kind: 'malformed-response' }));
    expect(() => validateApiConnectorResponse(structured, response(200, '{"data":{}}')))
      .toThrow(/missing declared output/i);
  });

  it('requires successful, valid OAuth token responses', () => {
    expect(parseOAuthTokenResponse(response(200, '{"access_token":"secret","expires_in":60}'), 'access_token'))
      .toEqual({ token: 'secret', expiresIn: 60 });
    expect(() => parseOAuthTokenResponse(response(401, '{}'), 'access_token'))
      .toThrowError(expect.objectContaining<ApiConnectorError>({ kind: 'authentication' }));
    expect(() => parseOAuthTokenResponse(response(200, '{}'), 'access_token'))
      .toThrow(/does not contain a token/i);
  });
});
