import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import { getDataPrefix, workspaceStore } from './workspace.svelte';
import type {
  ApiCollection, ApiRequest, ApiResponse, ApiKeyValue, ApiParam, ApiOutputSchemaField,
  ApiFieldType, ApiEnvironment, ApiAuth, HttpMethod,
} from '$lib/types/api-connection';

function getFile() { return `${getDataPrefix()}api-workspace.json`; }

interface Workspace {
  collections: ApiCollection[];
  requests: ApiRequest[];
  environments: ApiEnvironment[];
  activeEnvironmentId: string | null;
}

export function resolveVars(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ── Migration helpers (back-compat with the pre-Bubble api-workspace.json) ──────

function migrateParam(p: Partial<ApiParam> & Partial<ApiKeyValue>): ApiParam {
  return {
    key: p.key ?? '',
    value: p.value ?? '',
    private: p.private ?? false,
    querystring: p.querystring ?? true,
    optional: p.optional ?? false,
    enabled: p.enabled ?? true,
  };
}

function migrateCollection(c: Partial<ApiCollection>): ApiCollection {
  return {
    id: c.id ?? crypto.randomUUID(),
    name: c.name ?? 'API',
    auth: c.auth ?? { type: 'none' },
    sharedHeaders: c.sharedHeaders ?? [],
    sharedParams: (c.sharedParams ?? []).map(migrateParam),
    createdAt: c.createdAt ?? Date.now(),
  };
}

function migrateRequest(r: Partial<ApiRequest>): ApiRequest {
  const now = Date.now();
  return {
    id: r.id ?? crypto.randomUUID(),
    collectionId: r.collectionId ?? '',
    name: r.name ?? 'New call',
    useAs: r.useAs ?? 'data',
    method: r.method ?? 'GET',
    url: r.url ?? '',
    params: (r.params ?? []).map(migrateParam),
    headers: r.headers ?? [],
    body: r.body ?? { type: 'none', content: '' },
    auth: r.auth ?? { type: 'inherit' },
    createdAt: r.createdAt ?? now,
    updatedAt: r.updatedAt ?? now,
    outputSchema: r.outputSchema,
    lastResponse: r.lastResponse,
  };
}

function createApiStore() {
  let collections = $state<ApiCollection[]>([]);
  let requests = $state<ApiRequest[]>([]);
  let environments = $state<ApiEnvironment[]>([]);
  let activeEnvironmentId = $state<string | null>(null);
  let initialized = false;

  async function persist() {
    const data: Workspace = { collections, requests, environments, activeEnvironmentId };
    await appStorage.writeText(getFile(), JSON.stringify(data, null, 2));
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
    requestById(id: string) { return requests.find(r => r.id === id) ?? null; },
    collectionById(id: string) { return collections.find(c => c.id === id) ?? null; },

    async init() {
      if (initialized) return;
      initialized = true;
      const api = liatir();
      if (!api) return;
      try {
        if (await appStorage.exists(getFile())) {
          const raw = await appStorage.readText(getFile());
          const data: Workspace = JSON.parse(raw);
          collections = (data.collections ?? []).map(migrateCollection);
          requests = (data.requests ?? []).map(migrateRequest);
          environments = data.environments ?? [];
          activeEnvironmentId = data.activeEnvironmentId ?? null;
        }
      } catch { collections = []; requests = []; environments = []; activeEnvironmentId = null; }
    },

    reset() {
      initialized = false;
      collections = [];
      requests = [];
      environments = [];
      activeEnvironmentId = null;
    },

    // ── Providers (collections) ──────────────────────────────────────────────

    async addCollection(name: string): Promise<ApiCollection> {
      const col: ApiCollection = {
        id: crypto.randomUUID(), name, auth: { type: 'none' },
        sharedHeaders: [], sharedParams: [], createdAt: Date.now(),
      };
      collections = [...collections, col];
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

    // ── Calls (requests) ──────────────────────────────────────────────────────

    async addRequest(collectionId: string, partial: Partial<Omit<ApiRequest, 'id' | 'collectionId' | 'createdAt' | 'updatedAt'>> = {}): Promise<ApiRequest> {
      const now = Date.now();
      const req: ApiRequest = {
        id: crypto.randomUUID(),
        collectionId,
        name: 'New call',
        useAs: 'data',
        method: 'GET',
        url: '',
        params: [],
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        body: { type: 'none', content: '' },
        auth: { type: 'inherit' },
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
          status: resp.status, statusText: resp.statusText, body: resp.body,
          headers: resp.headers, durationMs: resp.durationMs, timestamp: Date.now(),
        },
      } : r);
      await persist();
    },

    /** Run a call once, capture the response, and return an inferred typed schema (does not auto-save it). */
    async initializeCall(
      req: ApiRequest,
      overrides: Record<string, string> = {},
    ): Promise<{ response: ApiResponse; schema: Record<string, ApiOutputSchemaField> }> {
      const provider = collections.find(c => c.id === req.collectionId) ?? undefined;
      const response = await sendApiRequest(req, { provider, paramOverrides: overrides, envVars: this.activeEnvVars });
      await this.storeLastResponse(req.id, response);
      let schema: Record<string, ApiOutputSchemaField> = {};
      try { schema = inferSchema(JSON.parse(response.body)); } catch { /* not JSON */ }
      return { response, schema };
    },

    // ── Environments ──────────────────────────────────────────────────────────

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

// ── Schema inference (Bubble "Initialize call") ─────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}|$)/;

function inferField(value: unknown, path: string, label: string): ApiOutputSchemaField {
  if (Array.isArray(value)) {
    const items = value.length
      ? inferField(value[0], `${path}.0`, 'item')
      : { label: 'item', path: `${path}.0`, type: 'string' as ApiFieldType };
    return { label, path, type: 'array', items };
  }
  if (value !== null && typeof value === 'object') {
    const children: Record<string, ApiOutputSchemaField> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      children[k] = inferField(v, path ? `${path}.${k}` : k, k);
    }
    return { label, path, type: 'object', children };
  }
  let type: ApiFieldType = 'string';
  if (typeof value === 'number') type = 'number';
  else if (typeof value === 'boolean') type = 'boolean';
  else if (typeof value === 'string' && ISO_DATE.test(value)) type = 'date';
  return { label, path, type };
}

export function inferSchema(json: unknown): Record<string, ApiOutputSchemaField> {
  if (json === null || typeof json !== 'object') {
    return { value: { label: 'value', path: '', type: 'string' } };
  }
  if (Array.isArray(json)) {
    return { items: inferField(json, '', 'items') };
  }
  const out: Record<string, ApiOutputSchemaField> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    out[k] = inferField(v, k, k);
  }
  return out;
}

// ── HTTP execution ──────────────────────────────────────────────────────────────

function getValueAtPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const part of path.replace(/^\$\./, '').split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function applyBrackets(str: string, values: Record<string, string>): string {
  return str.replace(/\[([^\]]+)\]/g, (_, k) => (k in values ? values[k] : `[${k}]`));
}
function applyAngles(str: string, values: Record<string, string>): string {
  return str.replace(/<([^>]+)>/g, (_, k) => (k in values ? values[k] : `<${k}>`));
}

function appendQuery(url: string, pairs: [string, string][]): string {
  if (!pairs.length) return url;
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}

function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signJwt(auth: ApiAuth, env: Record<string, string>): Promise<string> {
  const alg = auth.jwtAlg ?? 'HS256';
  const hash = ({ HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' } as const)[alg];
  const header = { alg, typ: 'JWT' };
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(resolveVars(auth.jwtPayload ?? '{}', env) || '{}'); } catch { payload = {}; }
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(auth.jwtSecret ?? ''), { name: 'HMAC', hash }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64urlBytes(new Uint8Array(sig))}`;
}

// OAuth2 token cache keyed by the auth's identifying fields.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function fetchOAuth2Token(auth: ApiAuth, env: Record<string, string>): Promise<string> {
  const r = (s: string) => resolveVars(s, env);
  const cacheKey = JSON.stringify([auth.type, auth.tokenUrl, auth.clientId, auth.username, auth.scope]);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5000) return cached.token;

  let body: string;
  let url: string;
  let headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };

  if (auth.type === 'oauth2-custom' && auth.customTokenRequest) {
    const ctr = auth.customTokenRequest;
    url = r(ctr.url);
    headers = {};
    for (const h of ctr.headers) if (h.enabled && h.key) headers[r(h.key)] = r(h.value);
    body = r(ctr.body.content);
    if (ctr.body.type === 'json') headers['Content-Type'] ??= 'application/json';
    const res = await fetch(url, { method: ctr.method, headers, body: body || undefined });
    const json = JSON.parse(await res.text());
    const token = String(getValueAtPath(json, auth.tokenPath ?? 'access_token') ?? '');
    const expiresIn = Number((json as Record<string, unknown>).expires_in ?? 3600);
    tokenCache.set(cacheKey, { token, expiresAt: Date.now() + expiresIn * 1000 });
    return token;
  }

  // oauth2-password
  const form = new URLSearchParams();
  form.set('grant_type', 'password');
  form.set('username', r(auth.username ?? ''));
  form.set('password', r(auth.password ?? ''));
  if (auth.clientId) form.set('client_id', r(auth.clientId));
  if (auth.clientSecret) form.set('client_secret', r(auth.clientSecret));
  if (auth.scope) form.set('scope', r(auth.scope));
  url = r(auth.tokenUrl ?? '');
  const res = await fetch(url, { method: 'POST', headers, body: form.toString() });
  const json = JSON.parse(await res.text());
  const token = String(getValueAtPath(json, auth.tokenPath ?? 'access_token') ?? '');
  const expiresIn = Number((json as Record<string, unknown>).expires_in ?? 3600);
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + expiresIn * 1000 });
  return token;
}

/**
 * Apply an auth config to the outgoing request. Mutates `headers` and returns extra
 * query pairs to append (for url-based key auth). `inherit` is resolved by the caller.
 */
async function applyAuth(
  auth: ApiAuth, headers: Record<string, string>, env: Record<string, string>,
): Promise<[string, string][]> {
  const r = (s: string) => resolveVars(s, env);
  const keyName = auth.keyName ?? auth.apiKeyHeader ?? '';
  const keyValue = auth.keyValue ?? auth.apiKeyValue ?? '';
  switch (auth.type) {
    case 'basic':
      if (auth.username) headers['Authorization'] = `Basic ${btoa(`${r(auth.username)}:${r(auth.password ?? '')}`)}`;
      return [];
    case 'bearer':
      if (auth.token) headers['Authorization'] = `Bearer ${r(auth.token)}`;
      return [];
    case 'api-key':
    case 'private-key-header':
      if (keyName) headers[r(keyName)] = r(keyValue);
      return [];
    case 'api-key-url':
    case 'private-key-url':
      return keyName ? [[r(keyName), r(keyValue)]] : [];
    case 'oauth2-password':
    case 'oauth2-custom': {
      const token = await fetchOAuth2Token(auth, env);
      if (token) headers['Authorization'] = `${auth.headerPrefix ?? 'Bearer'} ${token}`;
      return [];
    }
    case 'jwt': {
      const jwt = await signJwt(auth, env);
      headers['Authorization'] = `Bearer ${jwt}`;
      return [];
    }
    case 'oauth2-user-agent':
      // Phase 2 — not yet implemented.
      return [];
    default:
      return [];
  }
}

export async function sendApiRequest(
  req: ApiRequest,
  opts: {
    provider?: ApiCollection;
    paramOverrides?: Record<string, string>;
    envVars?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Promise<ApiResponse> {
  const workspaceVars = Object.fromEntries(
    workspaceStore.envVars
      .filter(v => v.enabled && v.key)
      .map(v => [v.key, v.value])
  );
  const env = { ...workspaceVars, ...(opts.envVars ?? {}) };
  const overrides = opts.paramOverrides ?? {};
  const r = (s: string) => resolveVars(s, env);

  // Effective params = provider shared params + call params (call overrides by key).
  const merged = new Map<string, ApiParam>();
  for (const p of opts.provider?.sharedParams ?? []) if (p.enabled && p.key) merged.set(p.key, p);
  for (const p of req.params) if (p.enabled && p.key) merged.set(p.key, p);
  const params = [...merged.values()];

  // Resolve each param's effective value (overrides apply to non-private params).
  const paramValues: Record<string, string> = {};
  for (const p of params) {
    const raw = (!p.private && overrides[p.key] !== undefined) ? overrides[p.key] : p.value;
    paramValues[p.key] = r(raw);
  }

  // Substitute [param] placeholders in URL + headers.
  let url = applyBrackets(r(req.url), paramValues);
  const headers: Record<string, string> = {};
  for (const h of [...(opts.provider?.sharedHeaders ?? []), ...req.headers]) {
    if (h.enabled && h.key) headers[applyBrackets(r(h.key), paramValues)] = applyBrackets(r(h.value), paramValues);
  }

  // Substitute <param> placeholders in the body.
  let bodyContent = applyAngles(r(req.body.content), paramValues);

  // Determine which params were consumed as placeholders (so we don't also send them).
  const consumed = new Set<string>();
  for (const k of Object.keys(paramValues)) {
    if (new RegExp(`\\[${escapeRe(k)}\\]`).test(req.url) ||
        req.headers.some(h => new RegExp(`\\[${escapeRe(k)}\\]`).test(h.key + h.value)) ||
        new RegExp(`<${escapeRe(k)}>`).test(req.body.content)) {
      consumed.add(k);
    }
  }

  // Remaining params: querystring → URL, body → merged into body.
  const queryPairs: [string, string][] = [];
  const bodyParams: [string, string][] = [];
  for (const p of params) {
    if (consumed.has(p.key)) continue;
    if (p.querystring) queryPairs.push([p.key, paramValues[p.key]]);
    else bodyParams.push([p.key, paramValues[p.key]]);
  }
  url = appendQuery(url, queryPairs);

  // Auth (resolve 'inherit' to the provider auth).
  const effectiveAuth: ApiAuth = req.auth.type === 'inherit'
    ? (opts.provider?.auth ?? { type: 'none' })
    : req.auth;
  const authQuery = await applyAuth(effectiveAuth, headers, env);
  url = appendQuery(url, authQuery);

  // Build the body.
  let body: BodyInit | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body.type === 'json') {
      let obj: Record<string, unknown> = {};
      try { obj = bodyContent ? JSON.parse(bodyContent) : {}; } catch { obj = {}; }
      for (const [k, v] of bodyParams) obj[k] = v;
      body = JSON.stringify(obj);
      headers['Content-Type'] ??= 'application/json';
    } else if (req.body.type === 'form-data') {
      const form = new URLSearchParams(bodyContent);
      for (const [k, v] of bodyParams) form.set(k, v);
      body = form.toString();
      headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
    } else if (req.body.type === 'raw') {
      body = bodyContent;
    } else if (bodyParams.length) {
      // body type 'none' but body params exist → send as form
      const form = new URLSearchParams();
      for (const [k, v] of bodyParams) form.set(k, v);
      body = form.toString();
      headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
    }
  }

  const t0 = Date.now();
  const res = await fetch(url, { method: req.method, headers, body, signal: opts.signal });
  const durationMs = Date.now() - t0;

  const resHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { resHeaders[k] = v; });

  return { status: res.status, statusText: res.statusText, headers: resHeaders, body: await res.text(), durationMs };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
