import { offlab } from '$lib/api';

export interface DataFile {
  id: string;
  name: string;
  path: string;
  ext: string;
  addedAt: number;
}

const INDEX = 'data-files.json';

function detectExt(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  if (/\.(fastq|fq)\.gz$/i.test(name)) return 'fastq.gz';
  if (/\.(fastq|fq)$/i.test(name)) return 'fastq';
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function createDataFilesStore() {
  let files = $state<DataFile[]>([]);
  let loading = $state(false);
  let initialized = false;

  async function persist() {
    const api = offlab();
    if (!api) return;
    await api.desktop.fs.data.writeText(INDEX, JSON.stringify(files));
  }

  return {
    get files() { return files; },
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
          files = JSON.parse(raw);
        }
      } catch { files = []; }
      finally { loading = false; }
    },

    async add(path: string) {
      if (files.some(f => f.path === path)) return;
      const name = path.split(/[\\/]/).pop() ?? path;
      files = [{
        id: crypto.randomUUID(),
        name,
        path,
        ext: detectExt(path),
        addedAt: Date.now(),
      }, ...files];
      await persist();
    },

    async remove(id: string) {
      files = files.filter(f => f.id !== id);
      await persist();
    },

    byExt(...exts: string[]): DataFile[] {
      return files.filter(f => exts.includes(f.ext));
    },

    async importFromPicker() {
      const api = offlab();
      if (!api) return;
      const result = await api.desktop.files.open({ multi: true });
      for (const path of result?.paths ?? []) {
        await this.add(path);
      }
    },

    async addSampleFastq() {
      const api = offlab();
      if (!api) return;
      const path = await api.invoke<string>('dtr_fastqc_sample_path');
      if (path) await this.add(path);
    },
  };
}

export const dataFiles = createDataFilesStore();
