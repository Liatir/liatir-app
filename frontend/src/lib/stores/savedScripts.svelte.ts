import { liatir } from '$lib/api';
import { getDataPrefix } from './workspace.svelte';

export interface SavedScript {
  id: string;
  name: string;
  code: string;
  savedAt: number;
  folder: string;
}

interface ScriptMeta {
  id: string;
  name: string;
  savedAt: number;
  folder: string;
}

interface IndexData {
  scripts: ScriptMeta[];
  folders: string[];
}

const LS_MIGRATE_KEY = 'liatir_scripts';

function getDir() { return `${getDataPrefix()}scripts`; }
function getIndex() { return `${getDir()}/index.json`; }
function scriptPath(id: string) { return `${getDir()}/${id}.ts`; }

function createSavedScriptsStore() {
  let scripts = $state<SavedScript[]>([]);
  let folders = $state<string[]>([]);
  let activeScriptId = $state<string | null>(null);
  let initialized = false;

  async function persistIndex() {
    const api = liatir();
    if (!api) return;
    const meta: ScriptMeta[] = scripts.map(({ id, name, savedAt, folder }) => ({ id, name, savedAt, folder }));
    await api.desktop.fs.data.writeText(getIndex(), JSON.stringify({ scripts: meta, folders }), { createDirs: true });
  }

  async function writeCode(id: string, code: string) {
    const api = liatir();
    if (!api) return;
    await api.desktop.fs.data.writeText(scriptPath(id), code, { createDirs: true });
  }

  async function deleteCode(id: string) {
    const api = liatir();
    if (!api) return;
    try { await api.desktop.fs.data.remove(scriptPath(id)); } catch { /* ignore */ }
  }

  return {
    get scripts() { return scripts; },
    get folders() { return folders; },
    get activeScriptId() { return activeScriptId; },

    get activeScript(): SavedScript | null {
      if (!activeScriptId) return null;
      return scripts.find(s => s.id === activeScriptId) ?? null;
    },

    async init() {
      if (initialized) return;
      initialized = true;
      const api = liatir();
      if (!api) return;
      try {
        if (await api.desktop.fs.data.exists(getIndex())) {
          // New format: read index then load all code files
          const raw = await api.desktop.fs.data.readText(getIndex());
          const data: IndexData = JSON.parse(raw);
          folders = data.folders ?? [];
          const metas = (data.scripts ?? []).map(s => ({ ...s, folder: s.folder ?? '' }));
          scripts = await Promise.all(metas.map(async (meta) => {
            let code = '';
            try {
              if (await api.desktop.fs.data.exists(scriptPath(meta.id))) {
                code = await api.desktop.fs.data.readText(scriptPath(meta.id));
              }
            } catch { /* code stays empty */ }
            return { ...meta, code };
          }));
        } else {
          // Try old single-file format: scripts.json
          const oldFile = `${getDataPrefix()}scripts.json`;
          const oldExists = await api.desktop.fs.data.exists(oldFile);
          if (oldExists) {
            const raw = await api.desktop.fs.data.readText(oldFile);
            const oldData = JSON.parse(raw) as { scripts?: (ScriptMeta & { code?: string })[]; folders?: string[] };
            folders = oldData.folders ?? [];
            const oldScripts = (oldData.scripts ?? []).map(s => ({ ...s, folder: s.folder ?? '', code: s.code ?? '' }));
            // Migrate: write individual .ts files
            await Promise.all(oldScripts.map(s => writeCode(s.id, s.code)));
            scripts = oldScripts;
            await persistIndex();
            try { await api.desktop.fs.data.remove(oldFile); } catch { /* ignore */ }
          } else {
            // Try legacy localStorage migration (only for root/no-workspace context)
            try {
              const lsRaw = localStorage.getItem(LS_MIGRATE_KEY);
              if (lsRaw) {
                const lsScripts = JSON.parse(lsRaw) as (ScriptMeta & { code?: string })[];
                scripts = lsScripts.map(s => ({ ...s, folder: s.folder ?? '', code: s.code ?? '' }));
                await Promise.all(scripts.map(s => writeCode(s.id, s.code)));
                await persistIndex();
                localStorage.removeItem(LS_MIGRATE_KEY);
              }
            } catch { /* ignore migration errors */ }
          }
        }
      } catch { scripts = []; folders = []; }
    },

    reset() {
      initialized = false;
      scripts = [];
      folders = [];
      activeScriptId = null;
    },

    async create(name: string, code: string, folder = ''): Promise<string> {
      const id = crypto.randomUUID();
      scripts = [{ id, name, code, savedAt: Date.now(), folder }, ...scripts];
      activeScriptId = id;
      await writeCode(id, code);
      await persistIndex();
      return id;
    },

    async update(id: string, name: string, code: string) {
      scripts = scripts.map(s => s.id === id ? { ...s, name, code, savedAt: Date.now() } : s);
      await writeCode(id, code);
      await persistIndex();
    },

    async remove(id: string) {
      scripts = scripts.filter(s => s.id !== id);
      if (activeScriptId === id) activeScriptId = null;
      await deleteCode(id);
      await persistIndex();
    },

    async move(id: string, folder: string) {
      scripts = scripts.map(s => s.id === id ? { ...s, folder } : s);
      await persistIndex();
    },

    async createFolder(path: string) {
      const trimmed = path.trim().replace(/^\/+|\/+$/g, '');
      if (!trimmed || folders.includes(trimmed)) return;
      folders = [...folders, trimmed].sort();
      await persistIndex();
    },

    async removeFolder(path: string) {
      folders = folders.filter(f => f !== path && !f.startsWith(path + '/'));
      scripts = scripts.map(s =>
        (s.folder === path || s.folder.startsWith(path + '/')) ? { ...s, folder: '' } : s
      );
      await persistIndex();
    },

    async renameFolder(oldPath: string, newPath: string) {
      const trimmed = newPath.trim().replace(/^\/+|\/+$/g, '');
      if (!trimmed || trimmed === oldPath) return;
      folders = folders.map(f => {
        if (f === oldPath) return trimmed;
        if (f.startsWith(oldPath + '/')) return trimmed + f.slice(oldPath.length);
        return f;
      }).sort();
      scripts = scripts.map(s => {
        if (s.folder === oldPath) return { ...s, folder: trimmed };
        if (s.folder.startsWith(oldPath + '/')) return { ...s, folder: trimmed + s.folder.slice(oldPath.length) };
        return s;
      });
      await persistIndex();
    },

    setActive(id: string | null) {
      activeScriptId = id;
    },

    byFolder(folder: string): SavedScript[] {
      return scripts.filter(s => s.folder === folder);
    },

    allFolderPaths(): string[] {
      const fromScripts = scripts.map(s => s.folder).filter(Boolean);
      return [...new Set([...folders, ...fromScripts])].sort();
    },

    async exportScript(id: string) {
      const script = scripts.find(s => s.id === id);
      if (!script) return;
      const api = liatir();
      if (!api) return;

      const destPath = await api.desktop.files.save(`${script.name}.ts`);
      if (!destPath) return;

      await api.invoke('lia_write_file_path', { path: destPath, content: script.code });
    },
  };
}

export const savedScripts = createSavedScriptsStore();
