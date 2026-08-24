import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import { getDataPrefix, workspaceStore } from './workspace.svelte';
import type {
  ApiCollection, ApiRequest, ApiResponse, ApiKeyValue, ApiParam, ApiOutputSchemaField,
  ApiFieldType, ApiAuth, HttpMethod,
} from '$lib/types/api-connection';
import {
  ApiConnectorError,
  parseOAuthTokenResponse,
  validateApiConnectorResponse,
} from '$lib/api/response-validation';

function getFile() { return `${getDataPrefix()}api-workspace.json`; }

interface Workspace {
  collections: ApiCollection[];
  requests: ApiRequest[];
}

export function resolveVars(str: string, vars: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ── Migration helpers ──────────────────────────────────────────────────────────

type LegacyApiParam = Partial<ApiParam> & Partial<ApiKeyValue> & {
  private?: boolean;
  querystring?: boolean;
  optional?: boolean;
};

function migrateParam(p: LegacyApiParam): ApiParam {
  return {
    key: p.key ?? '',
    value: p.value ?? '',
    exposedAsInput: p.exposedAsInput ?? !(p.private ?? false),
    location: p.location ?? (p.querystring === false ? 'body' : 'query'),
    required: p.required ?? !(p.optional ?? false),
    enabled: p.enabled ?? true,
  };
}

type LegacyApiAuth = Omit<Partial<ApiAuth>, 'type'> & {
  type?: string;
  apiKeyHeader?: string;
  apiKeyValue?: string;
};

function migrateAuth(auth: LegacyApiAuth | undefined, fallback: ApiAuth): ApiAuth {
  if (!auth?.type) return fallback;
  const { apiKeyHeader, apiKeyValue, ...current } = auth;
  const type = auth.type === 'private-key-header' || auth.type === 'api-key'
    ? 'api-key-header'
    : auth.type === 'private-key-url' || auth.type === 'api-key-url'
      ? 'api-key-query'
      : auth.type === 'oauth2-user-agent'
        ? 'none'
        : auth.type;
  return {
    ...current,
    type,
    keyName: current.keyName ?? apiKeyHeader,
    keyValue: current.keyValue ?? apiKeyValue,
  } as ApiAuth;
}

function migrateCollection(c: Partial<ApiCollection>): ApiCollection {
  return {
    id: c.id ?? crypto.randomUUID(),
    name: c.name ?? 'API',
    auth: migrateAuth(c.auth, { type: 'none' }),
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
    method: r.method ?? 'GET',
    url: r.url ?? '',
    params: (r.params ?? []).map(migrateParam),
    headers: r.headers ?? [],
    body: r.body
      ? { ...r.body, type: r.body.type === ('form-data' as typeof r.body.type) ? 'form-urlencoded' : r.body.type }
      : { type: 'none', content: '' },
    auth: migrateAuth(r.auth, { type: 'inherit' }),
    createdAt: r.createdAt ?? now,
    updatedAt: r.updatedAt ?? now,
    outputSchema: r.outputSchema,
    lastResponse: r.lastResponse,
  };
}

function createApiStore() {
  let collections = $state<ApiCollection[]>([]);
  let requests = $state<ApiRequest[]>([]);
  let initialized = false;
  let persistChain = Promise.resolve();

  async function persist() {
    const snapshot = JSON.stringify({ collections, requests } satisfies Workspace, null, 2);
    persistChain = persistChain.catch(() => {}).then(() => appStorage.writeText(getFile(), snapshot));
    await persistChain;
  }

  return {
    get collections() { return collections; },
    get requests() { return requests; },
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
      let loaded = false;
      try {
        if (await appStorage.exists(getFile())) {
          const raw = await appStorage.readText(getFile());
          const data: Workspace = JSON.parse(raw);
          collections = (data.collections ?? []).map(migrateCollection);
          requests = (data.requests ?? []).map(migrateRequest);
          loaded = true;
        }
      } catch { collections = []; requests = []; }
      // Rewrite successfully loaded legacy workspaces once using the current Liatir contract.
      if (loaded) await persist().catch(() => {});
    },

    reset() {
      initialized = false;
      collections = [];
      requests = [];
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

    // Legacy compat
    byId(id: string) { return requests.find(r => r.id === id) ?? null; },
    get list() { return requests; },
  };
}

export const apiConnections = createApiStore();

// ── Request templates and schema inference ─────────────────────────────────────

const BRACKET_PARAM = /\[([^\]]+)\]/g;
const BODY_PARAM = /<([^>]+)>/g;

export function requestTemplateParameterKeys(req: Pick<ApiRequest, 'url' | 'headers' | 'body'>): string[] {
  const keys = new Set<string>();
  const scan = (value: string, pattern: RegExp) => {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const key = match[1]?.trim();
      if (key) keys.add(key);
    }
  };
  scan(req.url, BRACKET_PARAM);
  for (const header of req.headers) {
    if (!header.enabled) continue;
    scan(header.key, BRACKET_PARAM);
    scan(header.value, BRACKET_PARAM);
  }
  if (req.body.type !== 'none') scan(req.body.content, BODY_PARAM);
  return [...keys];
}

/** Add newly referenced template parameters without deleting user-created rows. */
export function addDiscoveredParameters(req: ApiRequest, provider?: ApiCollection): ApiRequest {
  const existing = new Set([
    ...(provider?.sharedParams ?? []).map((parameter) => parameter.key),
    ...req.params.map((parameter) => parameter.key),
  ]);
  const additions = requestTemplateParameterKeys(req)
    .filter((key) => !existing.has(key))
    .map((key): ApiParam => ({
      key,
      value: '',
      exposedAsInput: true,
      location: 'query',
      required: true,
      enabled: true,
    }));
  return additions.length ? { ...req, params: [...req.params, ...additions] } : req;
}

export function addDiscoveredSharedParameters(provider: ApiCollection): ApiCollection {
  const keys = new Set(provider.sharedParams.map((parameter) => parameter.key));
  const discovered = new Set<string>();
  for (const header of provider.sharedHeaders) {
    if (!header.enabled) continue;
    for (const match of `${header.key}\n${header.value}`.matchAll(BRACKET_PARAM)) {
      const key = match[1]?.trim();
      if (key) discovered.add(key);
    }
  }
  const additions = [...discovered]
    .filter((key) => !keys.has(key))
    .map((key): ApiParam => ({
      key,
      value: '',
      exposedAsInput: true,
      location: 'query',
      required: true,
      enabled: true,
    }));
  return additions.length
    ? { ...provider, sharedParams: [...provider.sharedParams, ...additions] }
    : provider;
}

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
    return { value: inferField(json, '', 'value') };
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

export interface FlatApiOutputField {
  key: string;
  field: ApiOutputSchemaField;
}

/** Return the concrete outputs a pipeline can connect to, including nested object leaves. */
export function flattenApiOutputSchema(
  schema: Record<string, ApiOutputSchemaField>,
  prefix = '',
): FlatApiOutputField[] {
  const fields: FlatApiOutputField[] = [];
  for (const [key, field] of Object.entries(schema)) {
    const outputKey = prefix ? `${prefix}.${key}` : key;
    if (field.type === 'object' && field.children) {
      fields.push(...flattenApiOutputSchema(field.children, outputKey));
    } else {
      fields.push({ key: outputKey, field });
    }
  }
  return fields;
}

// ── HTTP execution ──────────────────────────────────────────────────────────────

function applyBrackets(str: string, values: Record<string, string>): string {
  return str.replace(/\[([^\]]+)\]/g, (_, rawKey) => {
    const key = String(rawKey).trim();
    return key in values ? values[key] : `[${rawKey}]`;
  });
}
function applyUrlBrackets(str: string, values: Record<string, string>): string {
  return str.replace(/\[([^\]]+)\]/g, (_, rawKey) => {
    const key = String(rawKey).trim();
    return key in values ? encodeURIComponent(values[key]) : `[${rawKey}]`;
  });
}
function applyAngles(str: string, values: Record<string, string>): string {
  return str.replace(/<([^>]+)>/g, (_, rawKey) => {
    const key = String(rawKey).trim();
    return key in values ? values[key] : `<${rawKey}>`;
  });
}

function applyJsonParameters(str: string, values: Record<string, string>): string {
  let result = str;
  for (const [key, value] of Object.entries(values)) {
    const escaped = escapeRe(key);
    // A complete quoted placeholder is replaced as a JSON string, including correct escaping.
    result = result.replace(new RegExp(`"<${escaped}>"`, 'g'), JSON.stringify(value));
  }
  return applyAngles(result, values);
}

function hasTemplateParameter(value: string, key: string): boolean {
  const escaped = escapeRe(key);
  return new RegExp(`\\[\\s*${escaped}\\s*\\]|<\\s*${escaped}\\s*>`).test(value);
}

function appendQuery(url: string, pairs: [string, string][]): string {
  if (!pairs.length) return url;
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const fragmentAt = url.indexOf('#');
  const base = fragmentAt >= 0 ? url.slice(0, fragmentAt) : url;
  const fragment = fragmentAt >= 0 ? url.slice(fragmentAt) : '';
  const separator = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${separator}${qs}${fragment}`;
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  if (existing && existing !== name) delete headers[existing];
  headers[name] = value;
}

function setHeaderIfMissing(headers: Record<string, string>, name: string, value: string): void {
  if (!Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase())) {
    headers[name] = value;
  }
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
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(resolveVars(auth.jwtPayload ?? '{}', env) || '{}');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JWT payload must be a JSON object.');
    }
    payload = parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid JWT payload: ${error instanceof Error ? error.message : String(error)}`);
  }
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(auth.jwtSecret ?? ''), { name: 'HMAC', hash }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64urlBytes(new Uint8Array(sig))}`;
}

// OAuth2 token cache keyed by the auth's identifying fields.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function nativeHttpRequest(
  request: {
    requestId: string;
    method: HttpMethod;
    url: string;
    headers: Record<string, string>;
    body?: string;
  },
  signal?: AbortSignal,
): Promise<ApiResponse> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  if (signal?.aborted) throw new DOMException('API request cancelled', 'AbortError');
  const cancel = () => { void api.desktop.network.cancelRequest(request.requestId); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    return await api.desktop.network.request(request);
  } catch (error) {
    if (signal?.aborted) throw new DOMException('API request cancelled', 'AbortError');
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

async function fetchOAuth2Token(
  auth: ApiAuth,
  env: Record<string, string>,
  signal?: AbortSignal,
): Promise<string> {
  const r = (s: string) => resolveVars(s, env);
  // Include the complete resolved auth request so two custom providers can never share a token by accident.
  const cacheKey = JSON.stringify([auth, env]);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 5000) return cached.token;

  let body: string | undefined;
  let url: string;
  let headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };

  if (auth.type === 'oauth2-custom' && auth.customTokenRequest) {
    const ctr = auth.customTokenRequest;
    url = r(ctr.url);
    headers = {};
    for (const h of ctr.headers) if (h.enabled && h.key) setHeader(headers, r(h.key), r(h.value));
    const content = r(ctr.body.content);
    if ((ctr.method === 'GET' || ctr.method === 'HEAD') && content.trim()) {
      throw new Error(`${ctr.method} OAuth token requests cannot send a body.`);
    }
    if (ctr.method === 'GET' || ctr.method === 'HEAD' || ctr.body.type === 'none') {
      body = undefined;
    } else if (ctr.body.type === 'json') {
      try { if (content.trim()) JSON.parse(content); } catch (error) {
        throw new Error(`Invalid OAuth token JSON body: ${error instanceof Error ? error.message : String(error)}`);
      }
      body = content || '{}';
      setHeaderIfMissing(headers, 'Content-Type', 'application/json');
    } else if (ctr.body.type === 'form-urlencoded') {
      body = new URLSearchParams(content).toString();
      setHeaderIfMissing(headers, 'Content-Type', 'application/x-www-form-urlencoded');
    } else {
      body = content;
    }
    const response = await nativeHttpRequest({
      requestId: crypto.randomUUID(),
      method: ctr.method,
      url,
      headers,
      body: body || undefined,
    }, signal);
    const { token, expiresIn } = parseOAuthTokenResponse(response, auth.tokenPath ?? 'access_token');
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
  const response = await nativeHttpRequest({
    requestId: crypto.randomUUID(),
    method: 'POST',
    url,
    headers,
    body: form.toString(),
  }, signal);
  const { token, expiresIn } = parseOAuthTokenResponse(response, auth.tokenPath ?? 'access_token');
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + expiresIn * 1000 });
  return token;
}

/**
 * Apply an auth config to the outgoing request. Mutates `headers` and returns extra
 * query pairs to append (for url-based key auth). `inherit` is resolved by the caller.
 */
async function applyAuth(
  auth: ApiAuth,
  headers: Record<string, string>,
  env: Record<string, string>,
  signal?: AbortSignal,
): Promise<[string, string][]> {
  const r = (s: string) => resolveVars(s, env);
  const keyName = auth.keyName ?? '';
  const keyValue = auth.keyValue ?? '';
  switch (auth.type) {
    case 'basic':
      if (auth.username) setHeader(headers, 'Authorization', `Basic ${btoa(`${r(auth.username)}:${r(auth.password ?? '')}`)}`);
      return [];
    case 'bearer':
      if (auth.token) setHeader(headers, 'Authorization', `Bearer ${r(auth.token)}`);
      return [];
    case 'api-key-header':
      if (keyName) setHeader(headers, r(keyName), r(keyValue));
      return [];
    case 'api-key-query':
      return keyName ? [[r(keyName), r(keyValue)]] : [];
    case 'oauth2-password':
    case 'oauth2-custom': {
      const token = await fetchOAuth2Token(auth, env, signal);
      if (token) setHeader(headers, 'Authorization', `${auth.headerPrefix ?? 'Bearer'} ${token}`);
      return [];
    }
    case 'jwt': {
      const jwt = await signJwt(auth, env);
      setHeader(headers, 'Authorization', `Bearer ${jwt}`);
      return [];
    }
    default:
      return [];
  }
}

export async function sendApiRequest(
  req: ApiRequest,
  opts: {
    provider?: ApiCollection;
    paramOverrides?: Record<string, string>;
    signal?: AbortSignal;
    requestId?: string;
    validateDeclaredSchema?: boolean;
  } = {},
): Promise<ApiResponse> {
  const workspaceVars = Object.fromEntries(
    workspaceStore.envVars
      .filter(v => v.enabled && v.key)
      .map(v => [v.key, v.value])
  );
  const env = workspaceVars;
  const overrides = opts.paramOverrides ?? {};
  const r = (s: string) => resolveVars(s, env);

  // Effective params = provider shared params + call params (call overrides by key).
  const merged = new Map<string, ApiParam>();
  for (const p of opts.provider?.sharedParams ?? []) if (p.enabled && p.key) merged.set(p.key, p);
  for (const p of req.params) if (p.enabled && p.key) merged.set(p.key, p);
  const params = [...merged.values()];
  const referencedKeys = requestTemplateParameterKeys({
    ...req,
    headers: [...(opts.provider?.sharedHeaders ?? []), ...req.headers],
  });
  const missingParameters = referencedKeys.filter((key) => !merged.has(key));
  if (missingParameters.length > 0) {
    throw new Error(`Missing API parameter${missingParameters.length === 1 ? '' : 's'}: ${missingParameters.join(', ')}.`);
  }

  // Resolve each parameter's effective value. Fixed parameters always keep their saved value.
  const paramValues: Record<string, string> = {};
  for (const p of params) {
    const raw = p.exposedAsInput && overrides[p.key] !== undefined ? overrides[p.key] : p.value;
    const value = r(raw);
    if (p.required && value.trim() === '') {
      throw new Error(`Required API parameter "${p.key}" needs a value.`);
    }
    paramValues[p.key] = value;
  }

  // Substitute [param] placeholders in URL + headers.
  let url = applyUrlBrackets(r(req.url), paramValues);
  const headers: Record<string, string> = {};
  for (const h of [...(opts.provider?.sharedHeaders ?? []), ...req.headers]) {
    if (h.enabled && h.key) {
      setHeader(headers, applyBrackets(r(h.key), paramValues), applyBrackets(r(h.value), paramValues));
    }
  }

  // URL and headers use brackets; bodies use angles so JSON arrays stay unambiguous.
  const rawBodyContent = r(req.body.content);
  const bodyContent = req.body.type === 'json'
    ? applyJsonParameters(rawBodyContent, paramValues)
    : applyAngles(rawBodyContent, paramValues);

  // Determine which params were consumed as placeholders (so we don't also send them).
  const consumed = new Set<string>();
  const allHeaders = [...(opts.provider?.sharedHeaders ?? []), ...req.headers]
    .filter((header) => header.enabled);
  for (const k of Object.keys(paramValues)) {
    if (hasTemplateParameter(req.url, k) ||
        allHeaders.some((header) => hasTemplateParameter(header.key, k) || hasTemplateParameter(header.value, k)) ||
        (req.body.type !== 'none' && hasTemplateParameter(req.body.content, k))) {
      consumed.add(k);
    }
  }

  // Remaining parameters follow their explicit query/body destination.
  const queryPairs: [string, string][] = [];
  const bodyParams: [string, string][] = [];
  for (const p of params) {
    if (consumed.has(p.key)) continue;
    if (!p.required && paramValues[p.key] === '') continue;
    if (p.location === 'query') queryPairs.push([p.key, paramValues[p.key]]);
    else bodyParams.push([p.key, paramValues[p.key]]);
  }
  url = appendQuery(url, queryPairs);

  // Auth (resolve 'inherit' to the provider auth).
  const effectiveAuth: ApiAuth = req.auth.type === 'inherit'
    ? (opts.provider?.auth ?? { type: 'none' })
    : req.auth;
  const authQuery = await applyAuth(effectiveAuth, headers, env, opts.signal);
  url = appendQuery(url, authQuery);

  // Build the body.
  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body.type === 'json') {
      let parsed: unknown;
      try {
        parsed = bodyContent ? JSON.parse(bodyContent) : {};
      } catch (error) {
        throw new Error(`Invalid JSON request body: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (bodyParams.length) {
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Body parameters can only be merged into a JSON object. Embed them with <parameter> instead.');
        }
        for (const [k, v] of bodyParams) (parsed as Record<string, unknown>)[k] = v;
      }
      body = JSON.stringify(parsed);
      setHeaderIfMissing(headers, 'Content-Type', 'application/json');
    } else if (req.body.type === 'form-urlencoded') {
      const form = new URLSearchParams(bodyContent);
      for (const [k, v] of bodyParams) form.set(k, v);
      body = form.toString();
      setHeaderIfMissing(headers, 'Content-Type', 'application/x-www-form-urlencoded');
    } else if (req.body.type === 'raw') {
      if (bodyParams.length) {
        throw new Error('Body parameters cannot be merged into raw text. Embed them with <parameter> instead.');
      }
      body = bodyContent;
    } else if (bodyParams.length) {
      // body type 'none' but body params exist → send as form
      const form = new URLSearchParams();
      for (const [k, v] of bodyParams) form.set(k, v);
      body = form.toString();
      setHeaderIfMissing(headers, 'Content-Type', 'application/x-www-form-urlencoded');
    }
  } else if (bodyParams.length > 0 || (req.body.type !== 'none' && bodyContent.trim())) {
    throw new Error(`${req.method} requests cannot send a body.`);
  }

  let response: ApiResponse;
  try {
    response = await nativeHttpRequest({
      requestId: opts.requestId ?? crypto.randomUUID(),
      method: req.method,
      url,
      headers,
      body: typeof body === 'string' ? body : undefined,
    }, opts.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiConnectorError(
      'network',
      `API request could not reach the server: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validateApiConnectorResponse(
    opts.validateDeclaredSchema === false ? { ...req, outputSchema: undefined } : req,
    response,
  );
  return response;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
