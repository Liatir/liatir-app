import { liatir } from '$lib/api';
import type { ApiConnection, ApiResponse, ApiKeyValue } from '$lib/types/api-connection';

const FILE = 'api-connections.json';

function createApiConnectionsStore() {
  let connections = $state<ApiConnection[]>([]);
  let initialized = false;

  async function persist() {
    const api = liatir();
    if (!api) return;
    await api.desktop.fs.data.writeText(FILE, JSON.stringify(connections, null, 2), { createDirs: true });
  }

  return {
    get list() { return connections; },

    byId(id: string) {
      return connections.find(c => c.id === id) ?? null;
    },

    async init() {
      if (initialized) return;
      initialized = true;
      const api = liatir();
      if (!api) return;
      try {
        const exists = await api.desktop.fs.data.exists(FILE);
        if (exists) {
          const raw = await api.desktop.fs.data.readText(FILE);
          connections = JSON.parse(raw) as ApiConnection[];
        }
      } catch { connections = []; }
    },

    async add(conn: ApiConnection) {
      connections = [conn, ...connections];
      await persist();
      return conn;
    },

    async update(conn: ApiConnection) {
      connections = connections.map(c => c.id === conn.id ? { ...conn, updatedAt: Date.now() } : c);
      await persist();
    },

    async remove(id: string) {
      connections = connections.filter(c => c.id !== id);
      await persist();
    },
  };
}

export const apiConnections = createApiConnectionsStore();

// ── HTTP execution ────────────────────────────────────────────────────────────

function buildUrl(base: string, params: ApiKeyValue[]): string {
  const enabled = params.filter(p => p.enabled && p.key);
  if (!enabled.length) return base;
  const qs = enabled.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  return base.includes('?') ? `${base}&${qs}` : `${base}?${qs}`;
}

export async function sendApiRequest(conn: ApiConnection): Promise<ApiResponse> {
  const url = buildUrl(conn.url, conn.params);
  const headers: Record<string, string> = {};

  for (const h of conn.headers) {
    if (h.enabled && h.key) headers[h.key] = h.value;
  }

  if (conn.auth.type === 'bearer' && conn.auth.token) {
    headers['Authorization'] = `Bearer ${conn.auth.token}`;
  } else if (conn.auth.type === 'basic' && conn.auth.username) {
    const b64 = btoa(`${conn.auth.username}:${conn.auth.password ?? ''}`);
    headers['Authorization'] = `Basic ${b64}`;
  }

  let body: BodyInit | undefined;
  if (conn.method !== 'GET' && conn.method !== 'HEAD') {
    if (conn.body.type === 'json' && conn.body.content) {
      body = conn.body.content;
      headers['Content-Type'] ??= 'application/json';
    } else if (conn.body.type === 'raw' && conn.body.content) {
      body = conn.body.content;
    } else if (conn.body.type === 'form-data' && conn.body.content) {
      body = conn.body.content;
    }
  }

  const t0 = Date.now();
  const res = await fetch(url, { method: conn.method, headers, body });
  const durationMs = Date.now() - t0;

  const resHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { resHeaders[k] = v; });

  const resBody = await res.text();

  return {
    status: res.status,
    statusText: res.statusText,
    headers: resHeaders,
    body: resBody,
    durationMs,
  };
}
