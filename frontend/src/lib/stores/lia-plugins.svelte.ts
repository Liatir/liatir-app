import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import { getDataPrefix } from './workspace.svelte';
import type { LiatirInputFieldSchema, LiatirOutputFieldSchema, LiatirPluginRuntime } from '@liatir/core';

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
  path: string;
  inputSchema: Record<string, PluginInputFieldDef>;
  outputSchema: Record<string, PluginOutputFieldDef>;
  addedAt: number;
}

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
  if (runtime === 'wasm' || runtime === 'python') return runtime;
  return 'node';
}

function normalizeCategory(category: unknown, runtime: PluginRuntime): string {
  if (typeof category === 'string' && category.trim()) {
    const cleanCategory = category.trim();
    if (cleanCategory === 'WASM Modules') return 'WASM Plugins';
    if (cleanCategory === 'Node Modules') return 'Node Plugins';
    if (cleanCategory === 'Modules') return 'Plugins';
    return cleanCategory;
  }
  if (runtime === 'python') return 'Python Plugins';
  return runtime === 'wasm' ? 'WASM Plugins' : 'Node Plugins';
}

function normalizePersistedPlugin(plugin: LiatirPlugin): LiatirPlugin {
  const runtime = normalizeRuntime(plugin.runtime);
  return {
    ...plugin,
    runtime,
    category: normalizeCategory(plugin.category, runtime),
    tags: normalizeTags(plugin.tags),
    inputSchema: plugin.inputSchema ?? {},
    outputSchema: plugin.outputSchema ?? {},
  };
}

function createLiaPluginsStore() {
  let plugins = $state<LiatirPlugin[]>([]);
  let initialized = false;

  async function persist() {
    await appStorage.writeText(getFile(), JSON.stringify(plugins));
  }

  return {
    get plugins() { return plugins; },

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
      } catch { plugins = []; }
    },

    reset() {
      initialized = false;
      plugins = [];
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

      const manifest = await api.invoke('lia_liatir_read_manifest', { path }) as {
        name: string;
        version: string;
        description?: string;
        runtime?: PluginRuntime;
        category?: string;
        tags?: string[];
        inputSchema?: Record<string, PluginInputFieldDef>;
        outputSchema?: Record<string, PluginOutputFieldDef>;
      };
      // Manifest declares the runtime; default to Node for backward compatibility.
      const runtime = normalizeRuntime(manifest.runtime);
      const category = normalizeCategory(manifest.category, runtime);
      const manifestTags = normalizeTags(manifest.tags);

      // Deduplicate by path — update if already imported
      const existing = plugins.find(m => m.path === path);
      if (existing) {
        plugins = plugins.map(m => m.path === path
          ? {
              ...m,
              name: manifest.name,
              version: manifest.version,
              description: manifest.description ?? '',
              runtime,
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
  };
}

export const liaPluginsStore = createLiaPluginsStore();
