import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import { getDataPrefix } from './workspace.svelte';

export interface FieldDef {
  type: 'string' | 'number' | 'boolean' | 'file';
  label?: string;
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  accept?: string[];
}

export interface LiatirModule {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Execution runtime declared in the manifest: Node subprocess or sandboxed WASM. */
  runtime: 'node' | 'wasm';
  path: string;
  inputSchema: Record<string, FieldDef>;
  outputSchema: Record<string, FieldDef>;
  addedAt: number;
}

function getFile() { return `${getDataPrefix()}liatir-modules.json`; }

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
          modules = JSON.parse(await appStorage.readText(getFile()));
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
        filters: [{ name: 'Liatir Bundle', extensions: ['liatir'] }],
      });
      const path = result?.paths?.[0];
      if (!path) return null;

      const manifest = await api.invoke('lia_liatir_read_manifest', { path }) as {
        name: string;
        version: string;
        description?: string;
        runtime?: 'node' | 'wasm';
        inputSchema?: Record<string, FieldDef>;
        outputSchema?: Record<string, FieldDef>;
      };
      // Manifest declares the runtime; default to Node for backward compatibility.
      const runtime: 'node' | 'wasm' = manifest.runtime === 'wasm' ? 'wasm' : 'node';

      // Deduplicate by path — update if already imported
      const existing = modules.find(m => m.path === path);
      if (existing) {
        modules = modules.map(m => m.path === path
          ? { ...m, name: manifest.name, version: manifest.version, description: manifest.description ?? '', runtime, inputSchema: manifest.inputSchema ?? {}, outputSchema: manifest.outputSchema ?? {} }
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

    byId(id: string): LiatirModule | null {
      return modules.find(m => m.id === id) ?? null;
    },
  };
}

export const modulesStore = createModulesStore();
