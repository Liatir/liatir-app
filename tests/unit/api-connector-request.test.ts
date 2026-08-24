import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiCollection, ApiRequest } from '../../frontend/src/lib/types/api-connection';

vi.stubGlobal('$state', <T>(value: T) => value);

const storage = vi.hoisted(() => ({ files: new Map<string, string>() }));

const nativeRequest = vi.fn(async () => ({
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'application/json' },
  body: '{"ok":true}',
  durationMs: 4,
}));

vi.mock('$lib/api', () => ({
  liatir: () => ({
    desktop: {
      network: {
        request: nativeRequest,
        cancelRequest: vi.fn(async () => true),
      },
    },
  }),
}));

vi.mock('$lib/stores/app-storage', () => ({
  appStorage: {
    writeText: vi.fn(async (path: string, content: string) => storage.files.set(path, content)),
    readText: vi.fn(async (path: string) => storage.files.get(path) ?? ''),
    exists: vi.fn(async (path: string) => storage.files.has(path)),
  },
}));

vi.mock('$lib/stores/workspace.svelte', () => ({
  getDataPrefix: () => 'workspaces/test/',
  workspaceStore: { envVars: [] },
}));

const {
  addDiscoveredParameters,
  addDiscoveredSharedParameters,
  apiConnections,
  flattenApiOutputSchema,
  inferSchema,
  sendApiRequest,
} = await import('../../frontend/src/lib/stores/apiConnections.svelte');

function request(patch: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'request',
    collectionId: 'collection',
    name: 'Call',
    method: 'GET',
    url: 'https://example.test',
    params: [],
    headers: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function collection(patch: Partial<ApiCollection> = {}): ApiCollection {
  return {
    id: 'collection',
    name: 'API',
    auth: { type: 'none' },
    sharedHeaders: [],
    sharedParams: [],
    createdAt: 1,
    ...patch,
  };
}

describe('API Connector request contract', () => {
  beforeEach(() => {
    nativeRequest.mockClear();
    storage.files.clear();
    apiConnections.reset();
  });

  it('migrates and rewrites saved Bubble fields into the Liatir contract', async () => {
    storage.files.set('workspaces/test/api-workspace.json', JSON.stringify({
      collections: [{
        id: 'collection', name: 'API', createdAt: 1,
        auth: { type: 'private-key-header', apiKeyHeader: 'X-Key', apiKeyValue: 'value' },
        sharedHeaders: [], sharedParams: [],
      }],
      requests: [{
        ...request(),
        useAs: 'action',
        body: { type: 'form-data', content: 'name=Ada' },
        params: [{ key: 'id', value: '1', private: true, querystring: false, optional: true, enabled: true }],
      }],
      environments: [{ id: 'unused', name: 'unused', variables: [] }],
      activeEnvironmentId: 'unused',
    }));

    await apiConnections.init();
    expect(apiConnections.requests[0]).toMatchObject({
      body: { type: 'form-urlencoded' },
      params: [{ key: 'id', exposedAsInput: false, location: 'body', required: false }],
    });
    expect(apiConnections.collections[0].auth.type).toBe('api-key-header');
    expect(apiConnections.collections[0].auth).toMatchObject({ keyName: 'X-Key', keyValue: 'value' });
    const rewritten = JSON.parse(storage.files.get('workspaces/test/api-workspace.json') ?? '{}');
    expect(rewritten).not.toHaveProperty('environments');
    expect(rewritten.requests[0]).not.toHaveProperty('useAs');
    expect(rewritten.requests[0].params[0]).not.toHaveProperty('private');
    expect(rewritten.collections[0].auth).not.toHaveProperty('apiKeyHeader');
  });

  it('discovers placeholders in URLs, headers and bodies without duplicating shared parameters', () => {
    const provider = collection({
      sharedParams: [{
        key: 'shared', value: '', exposedAsInput: true, location: 'query', required: true, enabled: true,
      }],
    });
    const updated = addDiscoveredParameters(request({
      url: 'https://example.test/[sample]',
      headers: [{ key: 'X-Token', value: '[token]', enabled: true }],
      body: { type: 'json', content: '{"name":"<name>","shared":"<shared>"}' },
    }), provider);

    expect(updated.params.map((parameter) => parameter.key)).toEqual(['sample', 'token', 'name']);
  });

  it('discovers placeholders in shared headers', () => {
    const updated = addDiscoveredSharedParameters(collection({
      sharedHeaders: [
        { key: 'X-Workspace', value: '[workspace]', enabled: true },
        { key: 'X-Disabled', value: '[ignored]', enabled: false },
      ],
    }));
    expect(updated.sharedParams.map((parameter) => parameter.key)).toEqual(['workspace']);
  });

  it('renders a native request with safe JSON substitution and omitted optional values', async () => {
    await sendApiRequest(request({
      method: 'POST',
      url: 'https://example.test/users/[id]',
      params: [
        { key: 'id', value: '', exposedAsInput: true, location: 'query', required: true, enabled: true },
        { key: 'name', value: '', exposedAsInput: true, location: 'body', required: true, enabled: true },
        { key: 'empty', value: '', exposedAsInput: true, location: 'query', required: false, enabled: true },
      ],
      body: { type: 'json', content: '{"name":"<name>"}' },
    }), { paramOverrides: { id: '42', name: 'Ada "L"' }, requestId: 'native-1' });

    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'native-1',
      method: 'POST',
      url: 'https://example.test/users/42',
      body: '{"name":"Ada \\"L\\""}',
    }));
  });

  it('keeps query parameters before URL fragments and accepts JSON arrays', async () => {
    await sendApiRequest(request({
      method: 'POST',
      url: 'https://example.test/items#section',
      params: [{ key: 'page', value: '2', exposedAsInput: false, location: 'query', required: true, enabled: true }],
      headers: [{ key: 'content-type', value: 'application/vnd.example+json', enabled: true }],
      body: { type: 'json', content: '[1, 2, 3]' },
    }));

    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.test/items?page=2#section',
      headers: { 'content-type': 'application/vnd.example+json' },
      body: '[1,2,3]',
    }));
  });

  it('rejects missing required values, invalid JSON and body parameters on GET before sending', async () => {
    const required = { key: 'id', value: '', exposedAsInput: true, location: 'query' as const, required: true, enabled: true };
    await expect(sendApiRequest(request({ params: [required] }))).rejects.toThrow(/required API parameter/i);
    await expect(sendApiRequest(request({
      method: 'POST',
      body: { type: 'json', content: '{bad' },
    }))).rejects.toThrow(/invalid JSON request body/i);
    await expect(sendApiRequest(request({
      params: [{ ...required, value: '42', location: 'body' }],
    }))).rejects.toThrow(/GET requests cannot send a body/i);
    await expect(sendApiRequest(request({
      method: 'POST',
      params: [{ ...required, value: '42', location: 'body' }],
      body: { type: 'raw', content: 'raw text' },
    }))).rejects.toThrow(/cannot be merged into raw text/i);
    await expect(sendApiRequest(request({
      body: { type: 'raw', content: 'not allowed' },
    }))).rejects.toThrow(/GET requests cannot send a body/i);
    expect(nativeRequest).not.toHaveBeenCalled();
  });

  it('infers primitive types and exposes nested leaves with stable keys', () => {
    const schema = inferSchema({ sample: { count: 3, ready: true }, created: '2026-08-24' });
    expect(flattenApiOutputSchema(schema).map(({ key, field }) => [key, field.type])).toEqual([
      ['sample.count', 'number'],
      ['sample.ready', 'boolean'],
      ['created', 'date'],
    ]);
    expect(inferSchema(7).value.type).toBe('number');
  });
});
