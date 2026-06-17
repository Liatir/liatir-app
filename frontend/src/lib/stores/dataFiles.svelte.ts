import { offlab } from '$lib/api';

export interface DataFile {
  id: string;
  name: string;
  path: string;
  ext: string;
  addedAt: number;
  folder: string;
}

interface StoredData {
  files: DataFile[];
  folders: string[];
}

const INDEX = 'data-files.json';

function detectExt(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  if (/\.(fastq|fq)\.gz$/i.test(name)) return 'fastq.gz';
  if (/\.(fastq|fq)$/i.test(name)) return 'fastq';
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function parseSaved(raw: string): StoredData {
  const parsed = JSON.parse(raw);
  // Backwards compat: old format was a plain array
  if (Array.isArray(parsed)) {
    return { files: parsed.map(f => ({ folder: '', ...f })), folders: [] };
  }
  return {
    files: (parsed.files ?? []).map((f: Partial<DataFile>) => ({ folder: '', ...f })),
    folders: parsed.folders ?? [],
  };
}

function createDataFilesStore() {
  let files = $state<DataFile[]>([]);
  let folders = $state<string[]>([]);
  let loading = $state(false);
  let initialized = false;

  async function persist() {
    const api = offlab();
    if (!api) return;
    const data: StoredData = { files, folders };
    await api.desktop.fs.data.writeText(INDEX, JSON.stringify(data));
  }

  return {
    get files() { return files; },
    get folders() { return folders; },
    get loading() { return loading; },

    async init() {
      if (initialized) return;
      initialized = true;
      const api = offlab();
      if (!api) return;
      loading = true;
      try {
        const exists = await api.desktop.fs.data.exists(INDEX);
        if (exists) {
          const raw = await api.desktop.fs.data.readText(INDEX);
          const data = parseSaved(raw);
          files = data.files;
          folders = data.folders;
        }
      } catch { files = []; folders = []; }
      finally { loading = false; }
    },

    async add(path: string, folder = '') {
      if (files.some(f => f.path === path)) return;
      const name = path.split(/[\\/]/).pop() ?? path;
      files = [{
        id: crypto.randomUUID(),
        name,
        path,
        ext: detectExt(path),
        addedAt: Date.now(),
        folder,
      }, ...files];
      await persist();
    },

    async remove(id: string) {
      files = files.filter(f => f.id !== id);
      await persist();
    },

    async move(id: string, folder: string) {
      files = files.map(f => f.id === id ? { ...f, folder } : f);
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
      files = files.map(f =>
        (f.folder === path || f.folder.startsWith(path + '/')) ? { ...f, folder: '' } : f
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
      files = files.map(f => {
        if (f.folder === oldPath) return { ...f, folder: trimmed };
        if (f.folder.startsWith(oldPath + '/')) return { ...f, folder: trimmed + f.folder.slice(oldPath.length) };
        return f;
      });
      await persist();
    },

    byExt(...exts: string[]): DataFile[] {
      return files.filter(f => exts.includes(f.ext));
    },

    byFolder(folder: string): DataFile[] {
      return files.filter(f => f.folder === folder);
    },

    allFolderPaths(): string[] {
      const fromFiles = files.map(f => f.folder).filter(Boolean);
      return [...new Set([...folders, ...fromFiles])].sort();
    },

    async importFromPicker(folder = '') {
      const api = offlab();
      if (!api) return;
      const result = await api.desktop.files.open({ multi: true });
      for (const path of result?.paths ?? []) {
        await this.add(path, folder);
      }
    },

    async addSampleFastq(folder = '') {
      const api = offlab();
      if (!api) return;
      const path = (await api.invoke('dtr_fastqc_sample_path')) as string | null;
      if (path) await this.add(path, folder);
    },
  };
}

export const dataFiles = createDataFilesStore();
