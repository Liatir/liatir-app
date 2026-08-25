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
  apiConnections,
  flattenApiOutputSchema,
  inferSchema,
  bodyTemplateParameterKeys,
  sendApiRequest,
  syncDiscoveredParameters,
  syncDiscoveredSharedParameters,
  urlAndHeaderTemplateParameterKeys,
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
        method: 'POST',
        url: 'https://example.test/[id]',
        useAs: 'action',
        body: { type: 'form-data', content: 'name=Ada' },
        params: [{ key: 'id', value: '1', private: true, querystring: false, optional: true, enabled: true }],
      }],
      environments: [{ id: 'unused', name: 'unused', variables: [] }],
      activeEnvironmentId: 'unused',
    }));

    await apiConnections.init();
    expect(apiConnections.requests[0]).toMatchObject({
      body: { type: 'form-urlencoded', content: '' },
      params: [
        { key: 'id', source: 'template', exposedAsInput: false, required: false },
        { key: 'name', value: 'Ada', source: 'manual' },
      ],
    });
    expect(apiConnections.collections[0].auth.type).toBe('api-key-header');
    expect(apiConnections.collections[0].auth).toMatchObject({ keyName: 'X-Key', keyValue: 'value' });
    const rewritten = JSON.parse(storage.files.get('workspaces/test/api-workspace.json') ?? '{}');
    expect(rewritten).not.toHaveProperty('environments');
    expect(rewritten.requests[0]).not.toHaveProperty('useAs');
    expect(rewritten.requests[0].params[0]).not.toHaveProperty('private');
    expect(rewritten.requests[0].params[0]).not.toHaveProperty('querystring');
    expect(rewritten.requests[0].params[0]).not.toHaveProperty('location');
    expect(rewritten.collections[0].auth).not.toHaveProperty('apiKeyHeader');
  });

  it('discovers placeholders in URLs, headers and bodies without duplicating shared parameters', () => {
    const provider = collection({
      sharedParams: [{
        key: 'shared', value: '', exposedAsInput: true, required: true, enabled: true,
      }],
    });
    const updated = syncDiscoveredParameters(request({
      url: 'https://example.test/[sample]',
      headers: [{ key: 'X-Token', value: '[token]', enabled: true }],
      body: { type: 'json', content: '{"name":"<name>","shared":"<shared>"}' },
    }), provider);

    expect(urlAndHeaderTemplateParameterKeys(updated)).toEqual(['sample', 'token']);
    expect(bodyTemplateParameterKeys(updated)).toEqual(['name', 'shared']);

    expect(updated.params.map((parameter) => [parameter.key, parameter.source])).toEqual([
      ['sample', 'template'],
      ['token', 'template'],
      ['name', 'template'],
    ]);
    const cleared = syncDiscoveredParameters({
      ...updated,
      url: 'https://example.test/',
      headers: [],
      body: { type: 'none', content: '' },
    }, provider);
    expect(cleared.params).toEqual([]);
  });

  it('removes saved body state from GET calls while keeping URL placeholders', async () => {
    storage.files.set('workspaces/test/api-workspace.json', JSON.stringify({
      collections: [collection()],
      requests: [{
        ...request({
          url: 'https://example.test/[id]',
          params: [
            { key: 'id', value: '42', source: 'template', exposedAsInput: true, required: true, enabled: true },
            { key: 'manual', value: 'hidden', source: 'manual', exposedAsInput: true, required: true, enabled: true },
            { key: 'raw', value: 'hidden', source: 'template', exposedAsInput: true, required: true, enabled: true },
          ],
          body: { type: 'raw', content: '<raw>' },
        }),
      }],
    }));

    await apiConnections.init();
    expect(apiConnections.requests[0]).toMatchObject({
      method: 'GET',
      body: { type: 'none', content: '' },
      params: [{ key: 'id', source: 'template' }],
    });
  });

  it('discovers placeholders in shared headers', () => {
    const updated = syncDiscoveredSharedParameters(collection({
      sharedHeaders: [
        { key: 'X-Workspace', value: '[workspace]', enabled: true },
        { key: 'X-Disabled', value: '[ignored]', enabled: false },
      ],
    }));
    expect(updated.sharedParams.map((parameter) => parameter.key)).toEqual(['workspace']);
  });

  it('promotes matching rows, replaces stale placeholders and preserves unrelated body fields', () => {
    const matching = {
      key: 'page', value: '1', source: 'manual' as const, exposedAsInput: false,
      required: true, enabled: true,
    };
    const manual = {
      key: 'locale', value: 'en', source: 'manual' as const, exposedAsInput: false,
      required: true, enabled: true,
    };
    const discovered = syncDiscoveredParameters(request({
      url: 'https://example.test/[page]/[param1]',
      params: [matching, manual],
    }));
    expect(discovered.params.map((parameter) => [parameter.key, parameter.source])).toEqual([
      ['page', 'template'],
      ['locale', 'manual'],
      ['param1', 'template'],
    ]);

    const renamed = syncDiscoveredParameters({ ...discovered, url: 'https://example.test/[param1.1]' });
    expect(renamed.params.map((parameter) => [parameter.key, parameter.source])).toEqual([
      ['locale', 'manual'],
      ['param1.1', 'template'],
    ]);

    const removed = syncDiscoveredParameters({ ...renamed, url: 'https://example.test/' });
    expect(removed.params).toEqual([manual]);
  });

  it('synchronizes shared-header placeholders without deleting manual shared parameters', () => {
    const manual = {
      key: 'locale', value: 'en', source: 'manual' as const, exposedAsInput: false,
      required: true, enabled: true,
    };
    const discovered = syncDiscoveredSharedParameters(collection({
      sharedHeaders: [{ key: 'X-Workspace', value: '[first]', enabled: true }],
      sharedParams: [manual],
    }));
    const renamed = syncDiscoveredSharedParameters({
      ...discovered,
      sharedHeaders: [{ key: 'X-Workspace', value: '[second]', enabled: true }],
    });
    expect(renamed.sharedParams.map((parameter) => [parameter.key, parameter.source])).toEqual([
      ['locale', 'manual'],
      ['second', 'template'],
    ]);
  });

  it('renders a native request with safe JSON substitution and omitted optional values', async () => {
    await sendApiRequest(request({
      method: 'POST',
      url: 'https://example.test/users/[id]',
      params: [
        { key: 'id', value: '', exposedAsInput: true, required: true, enabled: true },
        { key: 'name', value: '', exposedAsInput: true, required: true, enabled: true },
        { key: 'empty', value: '', exposedAsInput: true, required: false, enabled: true },
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

  it('substitutes URL parameters before fragments and accepts JSON arrays', async () => {
    await sendApiRequest(request({
      method: 'POST',
      url: 'https://example.test/items?page=[page]#section',
      params: [{ key: 'page', value: '2', exposedAsInput: false, required: true, enabled: true }],
      headers: [{ key: 'content-type', value: 'application/vnd.example+json', enabled: true }],
      body: { type: 'json', content: '[1, 2, 3]' },
    }));

    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.test/items?page=2#section',
      headers: { 'content-type': 'application/vnd.example+json' },
      body: '[1,2,3]',
    }));
  });

  it('sends manual parameters as body fields without inventing URL query parameters', async () => {
    await sendApiRequest(request({
      method: 'POST',
      url: 'https://example.test/items',
      params: [{
        key: 'page', value: '2', source: 'manual', exposedAsInput: false, required: true, enabled: true,
      }],
      body: { type: 'json', content: '{}' },
    }));

    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.test/items',
      body: '{"page":"2"}',
    }));
  });

  it('ignores unreferenced shared values instead of inventing a GET body', async () => {
    await sendApiRequest(request(), {
      provider: collection({
        sharedParams: [{
          key: 'unused', value: '', source: 'manual', exposedAsInput: true, required: true, enabled: true,
        }],
      }),
    });

    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      url: 'https://example.test',
      body: undefined,
    }));
  });

  it('rejects missing required values, invalid JSON and body fields on GET before sending', async () => {
    const required = { key: 'id', value: '', exposedAsInput: true, required: true, enabled: true };
    await expect(sendApiRequest(request({ params: [required] }))).rejects.toThrow(/required API parameter/i);
    await expect(sendApiRequest(request({
      method: 'POST',
      body: { type: 'json', content: '{bad' },
    }))).rejects.toThrow(/invalid JSON request body/i);
    await expect(sendApiRequest(request({
      params: [{ ...required, value: '42' }],
    }))).rejects.toThrow(/GET requests cannot send a body/i);
    await expect(sendApiRequest(request({
      method: 'POST',
      params: [{ ...required, value: '42' }],
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
