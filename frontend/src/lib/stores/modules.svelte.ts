import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import { getDataPrefix } from './workspace.svelte';
import type { LiatirInputFieldSchema, LiatirOutputFieldSchema } from '@liatir/core';

export type ModuleInputFieldDef = LiatirInputFieldSchema<string | number | boolean>;
export type ModuleOutputFieldDef = LiatirOutputFieldSchema;
export type FieldDef = ModuleInputFieldDef;

export interface LiatirModule {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  /** Execution runtime declared in the manifest: Node subprocess or sandboxed WASM. */
  runtime: 'node' | 'wasm';
  path: string;
  inputSchema: Record<string, ModuleInputFieldDef>;
  outputSchema: Record<string, ModuleOutputFieldDef>;
  addedAt: number;
}

function getFile() { return `${getDataPrefix()}liatir-modules.json`; }

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(
    tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map(tag => tag.trim())
      .filter(Boolean)
  )];
}

function normalizeCategory(category: unknown, runtime: 'node' | 'wasm'): string {
  if (typeof category === 'string' && category.trim()) return category.trim();
  return runtime === 'wasm' ? 'WASM Modules' : 'Node Modules';
}

function normalizePersistedModule(module: LiatirModule): LiatirModule {
  const runtime = module.runtime === 'wasm' ? 'wasm' : 'node';
  return {
    ...module,
    runtime,
    category: normalizeCategory(module.category, runtime),
    tags: normalizeTags(module.tags),
    inputSchema: module.inputSchema ?? {},
    outputSchema: module.outputSchema ?? {},
  };
}

function createModulesStore() {
  let modules = $state<LiatirModule[]>([]);
  let initialized = false;

  async function persist() {
    await appStorage.writeText(getFile(), JSON.stringify(modules));
  }

  return {
    get modules() { return modules; },

    async init() {
      if (initialized) return;
      initialized = true;
      const api = liatir();
      if (!api) return;
      try {
        const exists = await appStorage.exists(getFile());
        if (exists) {
          const parsed = JSON.parse(await appStorage.readText(getFile())) as LiatirModule[];
          modules = parsed.map(normalizePersistedModule);
        }
      } catch { modules = []; }
    },

    reset() {
      initialized = false;
      modules = [];
    },

    async importFromPicker(): Promise<LiatirModule | null> {
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
        runtime?: 'node' | 'wasm';
        category?: string;
        tags?: string[];
        inputSchema?: Record<string, ModuleInputFieldDef>;
        outputSchema?: Record<string, ModuleOutputFieldDef>;
      };
      // Manifest declares the runtime; default to Node for backward compatibility.
      const runtime: 'node' | 'wasm' = manifest.runtime === 'wasm' ? 'wasm' : 'node';
      const category = normalizeCategory(manifest.category, runtime);
      const manifestTags = normalizeTags(manifest.tags);

      // Deduplicate by path — update if already imported
      const existing = modules.find(m => m.path === path);
      if (existing) {
        modules = modules.map(m => m.path === path
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
        return modules.find(m => m.path === path)!;
      }

      const mod: LiatirModule = {
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

      modules = [mod, ...modules];
      await persist();
      return mod;
    },

    async remove(id: string) {
      modules = modules.filter(m => m.id !== id);
      await persist();
    },

    async setCategory(id: string, category: string) {
      const cleanCategory = category.trim();
      if (!cleanCategory) return;
      modules = modules.map(m => m.id === id ? { ...m, category: cleanCategory } : m);
      await persist();
    },

    async addTag(id: string, tag: string) {
      const cleanTag = tag.trim();
      if (!cleanTag) return;
      modules = modules.map(m => {
        if (m.id !== id) return m;
        return { ...m, tags: [...new Set([...(m.tags ?? []), cleanTag])] };
      });
      await persist();
    },

    async removeTag(id: string, tag: string) {
      modules = modules.map(m => m.id === id
        ? { ...m, tags: (m.tags ?? []).filter(existingTag => existingTag !== tag) }
        : m
      );
      await persist();
    },

    byId(id: string): LiatirModule | null {
      return modules.find(m => m.id === id) ?? null;
    },
  };
}

export const modulesStore = createModulesStore();
