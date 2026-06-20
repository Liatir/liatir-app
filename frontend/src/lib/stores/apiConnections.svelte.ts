import { liatir } from '$lib/api';
import type { ApiCollection, ApiRequest, ApiResponse, ApiKeyValue, ApiOutputSchemaField, ApiEnvironment, ApiAuth } from '$lib/types/api-connection';

const FILE = 'api-workspace.json';

interface Workspace {
  collections: ApiCollection[];
  requests: ApiRequest[];
  environments: ApiEnvironment[];
  activeEnvironmentId: string | null;
}

export function resolveVars(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function createApiStore() {
  let collections = $state<ApiCollection[]>([]);
  let requests = $state<ApiRequest[]>([]);
  let environments = $state<ApiEnvironment[]>([]);
  let activeEnvironmentId = $state<string | null>(null);
  let initialized = false;

  async function persist() {
    const api = liatir();
    if (!api) return;
    const data: Workspace = { collections, requests, environments, activeEnvironmentId };
    await api.desktop.fs.data.writeText(FILE, JSON.stringify(data, null, 2), { createDirs: true });
  }

  return {
    get collections() { return collections; },
    get requests() { return requests; },
    get environments() { return environments; },
    get activeEnvironmentId() { return activeEnvironmentId; },

    get activeEnvironment(): ApiEnvironment | null {
      return environments.find(e => e.id === activeEnvironmentId) ?? null;
    },

    get activeEnvVars(): Record<string, string> {
      const env = environments.find(e => e.id === activeEnvironmentId);
      if (!env) return {};
      return Object.fromEntries(
        env.variables.filter(v => v.enabled && v.key).map(v => [v.key, v.value])
      );
    },

    requestsInCollection(collectionId: string) {
      return requests.filter(r => r.collectionId === collectionId);
    },

    requestById(id: string) {
      return requests.find(r => r.id === id) ?? null;
    },

    collectionById(id: string) {
      return collections.find(c => c.id === id) ?? null;
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
          // backward compat: collections without auth field
          collections = (data.collections ?? []).map(c => ({ ...c, auth: c.auth ?? { type: 'none' } }));
          requests = data.requests ?? [];
          environments = data.environments ?? [];
          activeEnvironmentId = data.activeEnvironmentId ?? null;
        }
      } catch { collections = []; requests = []; environments = []; activeEnvironmentId = null; }
    },

    // ── Collections ─────────────────────────────────────────────────────────

    async addCollection(name: string): Promise<ApiCollection> {
      const col: ApiCollection = { id: crypto.randomUUID(), name, auth: { type: 'none' }, createdAt: Date.now() };
      collections = [col, ...collections];
      await persist();
      return col;
    },

    async renameCollection(id: string, name: string) {
      collections = collections.map(c => c.id === id ? { ...c, name } : c);
      await persist();
    },

    async updateCollection(col: ApiCollection) {
      collections = collections.map(c => c.id === col.id ? col : c);
      await persist();
    },

    async deleteCollection(id: string) {
      collections = collections.filter(c => c.id !== id);
      requests = requests.filter(r => r.collectionId !== id);
      await persist();
    },

    // ── Requests ─────────────────────────────────────────────────────────────

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

    async updateOutputSchema(id: string, schema: Record<string, ApiOutputSchemaField>) {
      requests = requests.map(r => r.id === id ? { ...r, outputSchema: schema, updatedAt: Date.now() } : r);
      await persist();
    },

    async storeLastResponse(id: string, resp: ApiResponse) {
      requests = requests.map(r => r.id === id ? {
        ...r,
        lastResponse: {
          status: resp.status,
          statusText: resp.statusText,
          body: resp.body,
          headers: resp.headers,
          durationMs: resp.durationMs,
          timestamp: Date.now(),
        },
      } : r);
      await persist();
    },

    // ── Environments ─────────────────────────────────────────────────────────

    async addEnvironment(name: string): Promise<ApiEnvironment> {
      const env: ApiEnvironment = { id: crypto.randomUUID(), name, variables: [], createdAt: Date.now() };
      environments = [...environments, env];
      await persist();
      return env;
    },

    async updateEnvironment(env: ApiEnvironment) {
      environments = environments.map(e => e.id === env.id ? env : e);
      await persist();
    },

    async deleteEnvironment(id: string) {
      environments = environments.filter(e => e.id !== id);
      if (activeEnvironmentId === id) activeEnvironmentId = null;
      await persist();
    },

    async setActiveEnvironment(id: string | null) {
      activeEnvironmentId = id;
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

export async function sendApiRequest(
  req: ApiRequest,
  opts: { collectionAuth?: ApiAuth; envVars?: Record<string, string> } = {}
): Promise<ApiResponse> {
  const vars = opts.envVars ?? {};
  const r = (s: string) => resolveVars(s, vars);

  // Resolve which auth to use: 'inherit' defers to collection auth
  const effectiveAuth: ApiAuth =
    req.auth.type === 'inherit' ? (opts.collectionAuth ?? { type: 'none' }) : req.auth;

  const resolvedParams = req.params.map(p => ({ ...p, key: r(p.key), value: r(p.value) }));
  const url = buildUrl(r(req.url), resolvedParams);

  const headers: Record<string, string> = {};
  for (const h of req.headers) {
    if (h.enabled && h.key) headers[r(h.key)] = r(h.value);
  }

  if (effectiveAuth.type === 'bearer' && effectiveAuth.token) {
    headers['Authorization'] = `Bearer ${r(effectiveAuth.token)}`;
  } else if (effectiveAuth.type === 'basic' && effectiveAuth.username) {
    headers['Authorization'] = `Basic ${btoa(`${r(effectiveAuth.username)}:${r(effectiveAuth.password ?? '')}`)}`;
  } else if (effectiveAuth.type === 'api-key' && effectiveAuth.apiKeyHeader && effectiveAuth.apiKeyValue) {
    headers[r(effectiveAuth.apiKeyHeader)] = r(effectiveAuth.apiKeyValue);
  }

  let body: BodyInit | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body.type === 'json' && req.body.content) {
      body = r(req.body.content);
      headers['Content-Type'] ??= 'application/json';
    } else if ((req.body.type === 'raw' || req.body.type === 'form-data') && req.body.content) {
      body = r(req.body.content);
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
