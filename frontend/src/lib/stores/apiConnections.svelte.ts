import { liatir } from '$lib/api';
import type { ApiCollection, ApiRequest, ApiResponse, ApiKeyValue } from '$lib/types/api-connection';

const FILE = 'api-workspace.json';

interface Workspace {
  collections: ApiCollection[];
  requests: ApiRequest[];
}

function createApiStore() {
  let collections = $state<ApiCollection[]>([]);
  let requests = $state<ApiRequest[]>([]);
  let initialized = false;

  async function persist() {
    const api = liatir();
    if (!api) return;
    const data: Workspace = { collections, requests };
    await api.desktop.fs.data.writeText(FILE, JSON.stringify(data, null, 2), { createDirs: true });
  }

  return {
    get collections() { return collections; },
    get requests() { return requests; },

    requestsInCollection(collectionId: string) {
      return requests.filter(r => r.collectionId === collectionId);
    },

    requestById(id: string) {
      return requests.find(r => r.id === id) ?? null;
    },

    async init() {
      if (initialized) return;
      initialized = true;
      const api = liatir();
      if (!api) return;
      try {
        if (await api.desktop.fs.data.exists(FILE)) {
          const raw = await api.desktop.fs.data.readText(FILE);
          const data: Workspace = JSON.parse(raw);
          collections = data.collections ?? [];
          requests = data.requests ?? [];
        }
      } catch { collections = []; requests = []; }
    },

    async addCollection(name: string): Promise<ApiCollection> {
      const col: ApiCollection = { id: crypto.randomUUID(), name, createdAt: Date.now() };
      collections = [col, ...collections];
      await persist();
      return col;
    },

    async renameCollection(id: string, name: string) {
      collections = collections.map(c => c.id === id ? { ...c, name } : c);
      await persist();
    },

    async deleteCollection(id: string) {
      collections = collections.filter(c => c.id !== id);
      requests = requests.filter(r => r.collectionId !== id);
      await persist();
    },

    async addRequest(collectionId: string, partial: Partial<Omit<ApiRequest, 'id' | 'collectionId' | 'createdAt' | 'updatedAt'>> = {}): Promise<ApiRequest> {
      const now = Date.now();
      const req: ApiRequest = {
        id: crypto.randomUUID(),
        collectionId,
        name: 'New Request',
        method: 'GET',
        url: '',
        params: [],
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        body: { type: 'none', content: '' },
        auth: { type: 'none' },
        createdAt: now,
        updatedAt: now,
        ...partial,
      };
      requests = [...requests, req];
      await persist();
      return req;
    },

    async updateRequest(req: ApiRequest) {
      requests = requests.map(r => r.id === req.id ? { ...req, updatedAt: Date.now() } : r);
      await persist();
    },

    async deleteRequest(id: string) {
      requests = requests.filter(r => r.id !== id);
      await persist();
    },

    // Legacy compat
    byId(id: string) { return requests.find(r => r.id === id) ?? null; },
    get list() { return requests; },
  };
}

export const apiConnections = createApiStore();

// ── HTTP execution ────────────────────────────────────────────────────────────

function buildUrl(base: string, params: ApiKeyValue[]): string {
  const enabled = params.filter(p => p.enabled && p.key);
  if (!enabled.length) return base;
  const qs = enabled.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  return base.includes('?') ? `${base}&${qs}` : `${base}?${qs}`;
}

export async function sendApiRequest(req: ApiRequest): Promise<ApiResponse> {
  const url = buildUrl(req.url, req.params);
  const headers: Record<string, string> = {};

  for (const h of req.headers) {
    if (h.enabled && h.key) headers[h.key] = h.value;
  }

  if (req.auth.type === 'bearer' && req.auth.token) {
    headers['Authorization'] = `Bearer ${req.auth.token}`;
  } else if (req.auth.type === 'basic' && req.auth.username) {
    headers['Authorization'] = `Basic ${btoa(`${req.auth.username}:${req.auth.password ?? ''}`)}`;
  } else if (req.auth.type === 'api-key' && req.auth.apiKeyHeader && req.auth.apiKeyValue) {
    headers[req.auth.apiKeyHeader] = req.auth.apiKeyValue;
  }

  let body: BodyInit | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body.type === 'json' && req.body.content) {
      body = req.body.content;
      headers['Content-Type'] ??= 'application/json';
    } else if ((req.body.type === 'raw' || req.body.type === 'form-data') && req.body.content) {
      body = req.body.content;
    }
  }

  const t0 = Date.now();
  const res = await fetch(url, { method: req.method, headers, body });
  const durationMs = Date.now() - t0;

  const resHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { resHeaders[k] = v; });

  return {
    status: res.status,
    statusText: res.statusText,
    headers: resHeaders,
    body: await res.text(),
    durationMs,
  };
}
