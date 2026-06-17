import { offlab } from '$lib/api';

export interface SavedScript {
  id: string;
  name: string;
  code: string;
  savedAt: number;
  folder: string;
}

interface ScriptsData {
  scripts: SavedScript[];
  folders: string[];
}

const INDEX = 'scripts.json';
const LS_MIGRATE_KEY = 'offlab_scripts';

function createSavedScriptsStore() {
  let scripts = $state<SavedScript[]>([]);
  let folders = $state<string[]>([]);
  let activeScriptId = $state<string | null>(null);
  let initialized = false;

  async function persist() {
    const api = offlab();
    if (!api) return;
    const data: ScriptsData = { scripts, folders };
    await api.desktop.fs.data.writeText(INDEX, JSON.stringify(data));
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
      const api = offlab();
      if (!api) return;
      try {
        const exists = await api.desktop.fs.data.exists(INDEX);
        if (exists) {
          const raw = await api.desktop.fs.data.readText(INDEX);
          const data: ScriptsData = JSON.parse(raw);
          scripts = (data.scripts ?? []).map(s => ({ ...s, folder: s.folder ?? '' }));
          folders = data.folders ?? [];
        } else {
          // Migrate from localStorage
          try {
            const lsRaw = localStorage.getItem(LS_MIGRATE_KEY);
            if (lsRaw) {
              const lsScripts = JSON.parse(lsRaw) as Omit<SavedScript, 'folder'>[];
              scripts = lsScripts.map(s => ({ folder: '', ...s }));
              await persist();
              localStorage.removeItem(LS_MIGRATE_KEY);
            }
          } catch { /* ignore migration errors */ }
        }
      } catch { scripts = []; folders = []; }
    },

    async create(name: string, code: string, folder = ''): Promise<string> {
      const id = crypto.randomUUID();
      scripts = [{ id, name, code, savedAt: Date.now(), folder }, ...scripts];
      activeScriptId = id;
      await persist();
      return id;
    },

    async update(id: string, name: string, code: string) {
      scripts = scripts.map(s => s.id === id ? { ...s, name, code, savedAt: Date.now() } : s);
      await persist();
    },

    async remove(id: string) {
      scripts = scripts.filter(s => s.id !== id);
      if (activeScriptId === id) activeScriptId = null;
      await persist();
    },

    async move(id: string, folder: string) {
      scripts = scripts.map(s => s.id === id ? { ...s, folder } : s);
      await persist();
    },

    async createFolder(path: string) {
      const trimmed = path.trim().replace(/^\/+|\/+$/g, '');
      if (!trimmed || folders.includes(trimmed)) return;
      folders = [...folders, trimmed].sort();
      await persist();
    },

    async removeFolder(path: string) {
      folders = folders.filter(f => f !== path && !f.startsWith(path + '/'));
      scripts = scripts.map(s =>
        (s.folder === path || s.folder.startsWith(path + '/')) ? { ...s, folder: '' } : s
      );
      await persist();
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
      await persist();
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
  };
}

export const savedScripts = createSavedScriptsStore();
