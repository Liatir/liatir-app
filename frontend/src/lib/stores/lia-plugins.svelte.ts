import { liatirPluginRuntime } from '@liatir/core';
import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import { getDataPrefix } from './workspace.svelte';
import type {
  LiatirInputFieldSchema,
  LiatirPluginManifest,
  LiatirPluginRuntimeStatus,
  LiatirRPluginRuntimeSpec,
  LiatirNativePluginRuntimeSpec,
  LiatirOutputFieldSchema,
  LiatirPluginRuntime,
  LiatirPythonPluginRuntimeSpec,
  LiatirPythonRuntimeLock,
} from '@liatir/core';

export type PluginInputFieldDef = LiatirInputFieldSchema<string | number | boolean>;
export type PluginOutputFieldDef = LiatirOutputFieldSchema;
export type FieldDef = PluginInputFieldDef;
export type PluginRuntime = LiatirPluginRuntime;

export interface LiatirPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  /** Execution runtime declared in the manifest: Node subprocess, Python venv, or sandboxed WASM. */
  runtime: PluginRuntime;
  python?: LiatirPythonPluginRuntimeSpec;
  r?: LiatirRPluginRuntimeSpec;
  native?: LiatirNativePluginRuntimeSpec;
  path: string;
  inputSchema: Record<string, PluginInputFieldDef>;
  outputSchema: Record<string, PluginOutputFieldDef>;
  addedAt: number;
}

export interface PythonPluginRuntimeState {
  phase: 'idle' | 'checking' | 'ready' | 'not-prepared' | 'preparing' | 'error';
  installed: boolean;
  envId?: string;
  pythonPath?: string;
  pythonVersion?: string;
  sizeBytes?: number;
  missingPackages: string[];
  error?: string;
  lock?: LiatirPythonRuntimeLock;
  checkedAt?: number;
  updatedAt?: number;
}

interface PythonEnvStatusResponse {
  envId: string;
  pythonPath?: string | null;
  installed: boolean;
  missingPackages?: string[];
  error?: string | null;
  sizeBytes?: number | null;
  lock?: LiatirPythonRuntimeLock | null;
}

interface PythonEnvPrepareResponse {
  envId: string;
  pythonPath: string;
  sizeBytes?: number | null;
  lock?: LiatirPythonRuntimeLock | null;
}

const pendingRuntimeTasks = new Map<string, Promise<PythonPluginRuntimeState | null>>();

function getFile() { return `${getDataPrefix()}liatir-plugins.json`; }
function getLegacyFile() { return `${getDataPrefix()}liatir-modules.json`; }

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(
    tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map(tag => tag.trim())
      .filter(Boolean)
  )];
}

function normalizeRuntime(runtime: unknown): PluginRuntime {
  return liatirPluginRuntime(runtime);
}

function normalizeCategory(category: unknown, runtime: PluginRuntime): string {
  if (typeof category === 'string' && category.trim()) {
    const cleanCategory = category.trim();
    if (cleanCategory === 'WASM Modules') return 'WASM Plugins';
    if (cleanCategory === 'Node Modules') return 'Node Plugins';
    if (cleanCategory === 'Modules') return 'Plugins';
    return cleanCategory;
  }
  if (runtime === 'r') return 'R Plugins';
  if (runtime === 'native') return 'Native Plugins';
  if (runtime === 'python') return 'Python Plugins';
  return runtime === 'wasm' ? 'WASM Plugins' : 'Node Plugins';
}

function normalizePersistedPlugin(plugin: LiatirPlugin): LiatirPlugin {
  const runtime = normalizeRuntime(plugin.runtime);
  return {
    ...plugin,
    runtime,
    python: runtime === 'python' ? plugin.python : undefined,
    r: runtime === 'r' ? plugin.r : undefined,
    native: runtime === 'native' ? plugin.native : undefined,
    category: normalizeCategory(plugin.category, runtime),
    tags: normalizeTags(plugin.tags),
    inputSchema: plugin.inputSchema ?? {},
    outputSchema: plugin.outputSchema ?? {},
  };
}

function stateFromPythonStatus(status: PythonEnvStatusResponse): PythonPluginRuntimeState {
  const missingPackages = status.missingPackages ?? [];
  const error = status.error ?? undefined;
  const installed = status.installed && missingPackages.length === 0 && !error;
  return {
    phase: error ? 'error' : installed ? 'ready' : 'not-prepared',
    installed,
    envId: status.envId,
    pythonPath: status.pythonPath ?? undefined,
    pythonVersion: status.lock?.pythonVersion,
    sizeBytes: status.sizeBytes ?? undefined,
    missingPackages,
    error,
    lock: status.lock ?? undefined,
    checkedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function stateFromPythonPrepare(prepared: PythonEnvPrepareResponse): PythonPluginRuntimeState {
  return {
    phase: 'ready',
    installed: true,
    envId: prepared.envId,
    pythonPath: prepared.pythonPath,
    pythonVersion: prepared.lock?.pythonVersion,
    sizeBytes: prepared.sizeBytes ?? undefined,
    missingPackages: [],
    lock: prepared.lock ?? undefined,
    checkedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createLiaPluginsStore() {
  let plugins = $state<LiatirPlugin[]>([]);
  let pythonRuntimeStates = $state<Record<string, PythonPluginRuntimeState>>({});
  let subprocessStates = $state<Record<string, LiatirPluginRuntimeStatus & { busy?: boolean }>>({});
  const subprocessTasks = new Map<string, Promise<void>>();
  let loadError = $state<string | null>(null);
  let initialized = false;
  let generation = 0;

  async function persist() {
    await appStorage.writeText(getFile(), JSON.stringify(plugins));
  }

  return {
    get plugins() { return plugins; },
    get loadError() { return loadError; },
    get subprocessStates() { return subprocessStates; },
    async refreshRuntime(id: string, action: 'status' | 'prepare' | 'trustNative' = 'status'): Promise<void> {
      const plugin = plugins.find(item => item.id === id);
      const api = liatir();
      if (!api || !plugin || (plugin.runtime !== 'r' && plugin.runtime !== 'native')) return;
      const pending = subprocessTasks.get(id);
      if (pending) return pending;
      const currentGeneration = generation;
      const runtime = plugin.runtime;
      subprocessStates = { ...subprocessStates, [id]: { ...subprocessStates[id], runtime, ready: false, busy: true } };
      // Start only after the task owns its map entry; late results compare that ownership.
      const task = Promise.resolve().then(async () => {
        let state: LiatirPluginRuntimeStatus;
        try { state = await api.pluginRuntimes[action](plugin.path); }
        catch (error) { state = { runtime, ready: false, error: String(error) }; }
        if (generation === currentGeneration && subprocessTasks.get(id) === task && plugins.some(item => item.id === id && item.path === plugin.path)) {
          subprocessStates = { ...subprocessStates, [id]: state };
        }
      }).finally(() => { if (generation === currentGeneration && subprocessTasks.get(id) === task) subprocessTasks.delete(id); });
      subprocessTasks.set(id, task);
      return task;
    },
    get pythonRuntimeStates() { return pythonRuntimeStates; },

    async init() {
      if (initialized) return;
      initialized = true;
      const api = liatir();
      if (!api) return;
      try {
        const exists = await appStorage.exists(getFile());
        if (exists) {
          const parsed = JSON.parse(await appStorage.readText(getFile())) as LiatirPlugin[];
          plugins = parsed.map(normalizePersistedPlugin);
          return;
        }

        const legacyExists = await appStorage.exists(getLegacyFile());
        if (legacyExists) {
          const parsed = JSON.parse(await appStorage.readText(getLegacyFile())) as LiatirPlugin[];
          plugins = parsed.map(normalizePersistedPlugin);
          await persist();
        }
      } catch (error) { plugins = []; loadError = String(error); }
    },

    reset() {
      loadError = null;
      generation += 1;
      subprocessStates = {};
      subprocessTasks.clear();
      initialized = false;
      plugins = [];
      pythonRuntimeStates = {};
      pendingRuntimeTasks.clear();
    },

    async importFromPicker(): Promise<LiatirPlugin | null> {
      const api = liatir();
      if (!api) return null;
      const result = await api.desktop.files.open({
        multi: false,
        allowed: ['lia'],
      });
      const path = result?.paths?.[0];
      if (!path) return null;

      const manifest = await api.invoke('lia_liatir_read_manifest', { path }) as Omit<LiatirPluginManifest, 'inputSchema'> & { inputSchema: Record<string, PluginInputFieldDef> };
      // Manifest declares the runtime; default to Node for backward compatibility.
      const runtime = normalizeRuntime(manifest.runtime);
      const category = normalizeCategory(manifest.category, runtime);
      const manifestTags = normalizeTags(manifest.tags);

      // Deduplicate by path — update if already imported
      const existing = plugins.find(m => m.path === path);
      if (existing) {
        const { [existing.id]: _oldState, ...remaining } = subprocessStates;
        subprocessStates = remaining;
        subprocessTasks.delete(existing.id);
        plugins = plugins.map(m => m.path === path
          ? {
              ...m,
              name: manifest.name,
              version: manifest.version,
              description: manifest.description ?? '',
              runtime,
              python: runtime === 'python' ? manifest.python : undefined,
              r: runtime === 'r' ? manifest.r : undefined,
              native: runtime === 'native' ? manifest.native : undefined,
              category,
              tags: [...new Set([...manifestTags, ...(m.tags ?? [])])],
              inputSchema: manifest.inputSchema ?? {},
              outputSchema: manifest.outputSchema ?? {},
            }
          : m
        );
        await persist();
        return plugins.find(m => m.path === path)!;
      }

      const plugin: LiatirPlugin = {
        id: crypto.randomUUID(),
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? '',
        category,
        tags: manifestTags,
        runtime,
        python: runtime === 'python' ? manifest.python : undefined,
        r: runtime === 'r' ? manifest.r : undefined,
        native: runtime === 'native' ? manifest.native : undefined,
        path,
        inputSchema: manifest.inputSchema ?? {},
        outputSchema: manifest.outputSchema ?? {},
        addedAt: Date.now(),
      };

      plugins = [plugin, ...plugins];
      await persist();
      return plugin;
    },

    async remove(id: string) {
      plugins = plugins.filter(m => m.id !== id);
      await persist();
    },

    async setCategory(id: string, category: string) {
      const cleanCategory = category.trim();
      if (!cleanCategory) return;
      plugins = plugins.map(m => m.id === id ? { ...m, category: cleanCategory } : m);
      await persist();
    },

    async addTag(id: string, tag: string) {
      const cleanTag = tag.trim();
      if (!cleanTag) return;
      plugins = plugins.map(m => {
        if (m.id !== id) return m;
        return { ...m, tags: [...new Set([...(m.tags ?? []), cleanTag])] };
      });
      await persist();
    },

    async removeTag(id: string, tag: string) {
      plugins = plugins.map(m => m.id === id
        ? { ...m, tags: (m.tags ?? []).filter(existingTag => existingTag !== tag) }
        : m
      );
      await persist();
    },

    byId(id: string): LiatirPlugin | null {
      return plugins.find(m => m.id === id) ?? null;
    },

    runtimeState(id: string): PythonPluginRuntimeState | null {
      return pythonRuntimeStates[id] ?? null;
    },

    async ensurePythonRuntimeStatus(id: string): Promise<PythonPluginRuntimeState | null> {
      const existing = pythonRuntimeStates[id];
      if (existing && existing.phase !== 'checking' && existing.phase !== 'preparing') return existing;
      return this.refreshPythonRuntimeStatus(id);
    },

    async refreshPythonRuntimeStatus(id: string): Promise<PythonPluginRuntimeState | null> {
      const plugin = plugins.find(item => item.id === id);
      if (!plugin || plugin.runtime !== 'python') return null;
      const key = `status:${id}`;
      const pending = pendingRuntimeTasks.get(key);
      if (pending) return pending;

      const task = (async () => {
        const previous = pythonRuntimeStates[id];
        pythonRuntimeStates = {
          ...pythonRuntimeStates,
          [id]: {
            phase: 'checking',
            installed: previous?.installed ?? false,
            envId: previous?.envId,
            pythonPath: previous?.pythonPath,
            pythonVersion: previous?.pythonVersion,
            sizeBytes: previous?.sizeBytes,
            missingPackages: previous?.missingPackages ?? [],
            lock: previous?.lock,
            checkedAt: previous?.checkedAt,
            updatedAt: Date.now(),
          },
        };

        const api = liatir();
        if (!api) {
          const state: PythonPluginRuntimeState = {
            phase: 'error',
            installed: false,
            missingPackages: [],
            error: 'Liatir API not available',
            updatedAt: Date.now(),
          };
          pythonRuntimeStates = { ...pythonRuntimeStates, [id]: state };
          return state;
        }

        try {
          const status = await api.invoke('lia_liatir_python_runtime_status', { path: plugin.path }) as PythonEnvStatusResponse;
          const state = stateFromPythonStatus(status);
          pythonRuntimeStates = { ...pythonRuntimeStates, [id]: state };
          return state;
        } catch (error) {
          const state: PythonPluginRuntimeState = {
            phase: 'error',
            installed: false,
            missingPackages: [],
            error: String(error),
            checkedAt: Date.now(),
            updatedAt: Date.now(),
          };
          pythonRuntimeStates = { ...pythonRuntimeStates, [id]: state };
          return state;
        }
      })().finally(() => pendingRuntimeTasks.delete(key));

      pendingRuntimeTasks.set(key, task);
      return task;
    },

    async preparePythonRuntime(id: string): Promise<PythonPluginRuntimeState | null> {
      const plugin = plugins.find(item => item.id === id);
      if (!plugin || plugin.runtime !== 'python') return null;
      const key = `prepare:${id}`;
      const pending = pendingRuntimeTasks.get(key);
      if (pending) return pending;

      const task = (async () => {
        const previous = pythonRuntimeStates[id];
        pythonRuntimeStates = {
          ...pythonRuntimeStates,
          [id]: {
            phase: 'preparing',
            installed: previous?.installed ?? false,
            envId: previous?.envId,
            pythonPath: previous?.pythonPath,
            pythonVersion: previous?.pythonVersion,
            sizeBytes: previous?.sizeBytes,
            missingPackages: previous?.missingPackages ?? [],
            lock: previous?.lock,
            checkedAt: previous?.checkedAt,
            updatedAt: Date.now(),
          },
        };

        const api = liatir();
        if (!api) {
          const state: PythonPluginRuntimeState = {
            phase: 'error',
            installed: false,
            missingPackages: [],
            error: 'Liatir API not available',
            updatedAt: Date.now(),
          };
          pythonRuntimeStates = { ...pythonRuntimeStates, [id]: state };
          return state;
        }

        try {
          const prepared = await api.invoke('lia_liatir_python_runtime_prepare', { path: plugin.path }) as PythonEnvPrepareResponse;
          const state = stateFromPythonPrepare(prepared);
          pythonRuntimeStates = { ...pythonRuntimeStates, [id]: state };
          return state;
        } catch (error) {
          const state: PythonPluginRuntimeState = {
            phase: 'error',
            installed: false,
            missingPackages: [],
            error: String(error),
            checkedAt: Date.now(),
            updatedAt: Date.now(),
          };
          pythonRuntimeStates = { ...pythonRuntimeStates, [id]: state };
          return state;
        }
      })().finally(() => pendingRuntimeTasks.delete(key));

      pendingRuntimeTasks.set(key, task);
      return task;
    },
  };
}

export const liaPluginsStore = createLiaPluginsStore();
