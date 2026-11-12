import { afterEach, beforeAll, expect, it, vi } from 'vitest';
const { api, plugin } = vi.hoisted(() => ({
  api: { pluginRuntimes: { status: vi.fn() } },
  plugin: { id: 'r-plugin', name: 'R test', version: '1', runtime: 'r', path: 'test.lia', inputSchema: {}, outputSchema: {}, addedAt: 1 },
}));
vi.mock('$lib/api', () => ({ liatir: () => api }));
vi.mock('$lib/stores/workspace.svelte', () => ({ workspaceStore: { init: async () => {}, workspaces: [] } }));
vi.mock('$lib/stores/app-storage', () => ({ appStorage: {
  exists: async (path: string) => path === 'plugins/catalog-v1.json', readText: async () => JSON.stringify({ plugins: [plugin], migratedSources: [] }), writeText: async () => {},
} }));
let store: typeof import('../../frontend/src/lib/stores/lia-plugins.svelte').liaPluginsStore;
beforeAll(async () => {
  vi.stubGlobal('$state', (value: unknown) => value);
  store = (await import('../../frontend/src/lib/stores/lia-plugins.svelte')).liaPluginsStore;
});
afterEach(() => { store.reset(); api.pluginRuntimes.status.mockReset(); });

it('metadata edits do not strand an in-flight runtime check in its busy state', async () => {
  let resolve!: (value: unknown) => void;
  api.pluginRuntimes.status.mockImplementation(() => new Promise(done => { resolve = done; }));
  await store.init();
  const pending = store.refreshRuntime(plugin.id);
  await store.setCategory(plugin.id, 'Statistics');
  resolve({ runtime: 'r', ready: true }); await pending;
  expect(store.subprocessStates[plugin.id]).toEqual({ runtime: 'r', ready: true });
});

it('an explicit catalog reload prevents a late result from overwriting the new check', async () => {
  const completions: Array<(value: unknown) => void> = [];
  api.pluginRuntimes.status.mockImplementation(() => new Promise(done => completions.push(done)));
  await store.init(); const old = store.refreshRuntime(plugin.id);
  store.reset(); await store.init(); const fresh = store.refreshRuntime(plugin.id);
  completions[0]({ runtime: 'r', ready: true }); await old;
  expect(store.subprocessStates[plugin.id].busy).toBe(true);
  completions[1]({ runtime: 'r', ready: false, error: 'New status' }); await fresh;
  expect(store.subprocessStates[plugin.id]).toEqual({ runtime: 'r', ready: false, error: 'New status' });
});
