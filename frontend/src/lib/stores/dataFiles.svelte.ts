import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import { getDataPrefix, SANDBOX_WORKSPACE_ID } from './workspace.svelte';
import { inspectAnnDataArtifact } from '$lib/scientific-artifacts';
import type { LiatirScientificArtifactMetadata } from '@liatir/core';

export interface DataFile {
  id: string;
  name: string;
  path: string;
  ext: string;
  size?: number;
  addedAt: number;
  folder: string;
  missing?: boolean;
  protected?: boolean;
  /** Versioned scientific profile metadata. Missing remains valid for legacy files. */
  scientific?: LiatirScientificArtifactMetadata;
}

interface StoredData {
  files: DataFile[];
  folders: string[];
}

function getFile() { return `${getDataPrefix()}data-files.json`; }

function detectExt(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  if (/\.sc-index\.json$/i.test(name))        return 'sc-index.json';
  if (/\.(fastq|fq)\.gz$/i.test(name))       return 'fastq.gz';
  if (/\.(fastq|fq)$/i.test(name))           return 'fastq';
  if (/\.(fasta|fa|fna|faa)\.gz$/i.test(name)) return 'fasta.gz';
  if (/\.(fasta|fa|fna|faa)$/i.test(name))   return 'fasta';
  if (/\.vcf\.gz$/i.test(name))              return 'vcf.gz';
  if (/\.bcf\.gz$/i.test(name))              return 'bcf.gz';
  const m = name.match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
}

const DEMO_FOLDER_PREFIX = 'Demo Files';
const RESULTS_FOLDER = 'Results';

function isProtectedFolder(path: string): boolean {
  return path === RESULTS_FOLDER || path.startsWith(RESULTS_FOLDER + '/') ||
         path === DEMO_FOLDER_PREFIX || path.startsWith(DEMO_FOLDER_PREFIX + '/');
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
    const data: StoredData = { files, folders };
    await appStorage.writeText(getFile(), JSON.stringify(data));
  }

  return {
    get files() { return files; },
    get folders() { return folders; },
    get loading() { return loading; },

    async init() {
      if (!initialized) {
        initialized = true;
        const api = liatir();
        if (api) {
          loading = true;
          try {
            const exists = await appStorage.exists(getFile());
            if (exists) {
              const raw = await appStorage.readText(getFile());
              const data = parseSaved(raw);
              files = data.files;
              folders = data.folders;

              // Back-fill missing sizes for files imported before size tracking
              const missing = files.filter(f => f.size == null);
              if (missing.length > 0) {
                const updated = await Promise.all(
                  files.map(async (f) => {
                    if (f.size != null) return f;
                    try {
                      const size = (await api.invoke('lia_file_size', { path: f.path })) as number;
                      return { ...f, size };
                    } catch { return f; }
                  })
                );
                files = updated;
                await persist();
              }
            }
          } catch { files = []; folders = []; }
          finally { loading = false; }
        }
      }
      // Always ensure demo files in Sandbox (idempotent dedup inside)
      if (getDataPrefix().includes(SANDBOX_WORKSPACE_ID)) {
        await this.initDemoFiles();
      }
    },

    reset() {
      initialized = false;
      files = [];
      folders = [];
      loading = false;
    },

    async clearResults() {
      files = files.filter(f => !(f.folder === RESULTS_FOLDER || f.folder.startsWith(RESULTS_FOLDER + '/')));
      folders = folders.filter(f => !(f === RESULTS_FOLDER || f.startsWith(RESULTS_FOLDER + '/')));
      await persist();
    },

    async initDemoFiles() {
      const api = liatir();
      if (!api) return;
      try {
        interface DemoEntry { path: string; folder: string; }
        const entries = await api.invoke('lia_init_demo_files') as DemoEntry[];
        let changed = false;

        for (const entry of entries) {
          if (files.some(f => f.path === entry.path)) continue;
          const name = entry.path.split(/[\\/]/).pop() ?? entry.path;
          let size: number | undefined;
          try { size = (await api.invoke('lia_file_size', { path: entry.path })) as number; } catch { /**/ }

          // Ensure the demo subfolder is registered
          if (!folders.includes(entry.folder)) {
            folders = [...folders, entry.folder].sort();
          }

          files = [...files, {
            id: crypto.randomUUID(),
            name,
            path: entry.path,
            ext: detectExt(entry.path),
            size,
            addedAt: 0,
            folder: entry.folder,
            protected: true,
          }];
          changed = true;
        }

        if (changed) await persist();
      } catch { /* demo files init is best-effort */ }
    },

    async add(path: string, folder = '', scientific?: LiatirScientificArtifactMetadata) {
      const existing = files.find(f => f.path === path);
      if (existing) {
        if (scientific && existing.scientific !== scientific) {
          files = files.map(file => file.path === path ? { ...file, scientific } : file);
          await persist();
        }
        return;
      }
      const name = path.split(/[\\/]/).pop() ?? path;
      let size: number | undefined;
      try {
        const api = liatir();
        if (api) size = (await api.invoke('lia_file_size', { path })) as number;
      } catch { /* size stays undefined */ }
      let detectedScientific = scientific;
      if (!detectedScientific && detectExt(path) === 'h5ad') {
        try {
          detectedScientific = await inspectAnnDataArtifact(path);
        } catch {
          // The file remains usable as a backward-compatible path. Validation can be retried later.
        }
      }
      files = [{
        id: crypto.randomUUID(),
        name,
        path,
        ext: detectExt(path),
        size,
        addedAt: Date.now(),
        folder,
        ...(detectedScientific ? { scientific: detectedScientific } : {}),
      }, ...files];
      await persist();
    },

    /**
     * Register a tool/job/pipeline result file under the locked `Results/<tool>/`
     * folder (folders auto-created). Mirrors how the pipeline stores its outputs.
     */
    async addToResults(path: string, toolName: string, scientific?: LiatirScientificArtifactMetadata) {
      const safe = toolName.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'tool';
      const folder = `${RESULTS_FOLDER}/${safe}`;
      await this.createFolder(RESULTS_FOLDER);
      await this.createFolder(folder);
      await this.add(path, folder, scientific);
    },

    async setScientific(path: string, scientific: LiatirScientificArtifactMetadata) {
      if (!files.some(file => file.path === path)) return;
      files = files.map(file => file.path === path ? { ...file, scientific } : file);
      await persist();
    },

    async ensureAnnDataProfile(path: string, refreshIdentity = false): Promise<LiatirScientificArtifactMetadata | undefined> {
      const file = files.find(item => item.path === path);
      if (!file || file.ext !== 'h5ad') return file?.scientific;
      if (file.scientific && !refreshIdentity) return file.scientific;
      const inspected = await inspectAnnDataArtifact(path);
      const scientific = file.scientific &&
        file.scientific.physical.artifactId === inspected.physical.artifactId
          ? file.scientific
          : inspected;
      await this.setScientific(path, scientific);
      return scientific;
    },

    async remove(id: string) {
      if (files.find(f => f.id === id)?.protected) return;
      files = files.filter(f => f.id !== id);
      await persist();
    },

    /**
     * Drop every entry pointing inside one of the given directories.
     *
     * Deleting a run takes its files with it, and an entry left behind would point at nothing —
     * the library would keep offering a file that is gone. Matching is on the path prefix because
     * that is the only thing tying a library entry to the run that produced it.
     */
    /** How many library entries point inside these directories. For telling the user before deleting. */
    countUnder(directories: string[]): number {
      const prefixes = directories.map((dir) => dir.replace(/[\\/]+$/, ''));
      return files.filter((file) =>
        !file.protected && prefixes.some((prefix) =>
          file.path === prefix || file.path.startsWith(`${prefix}/`) || file.path.startsWith(`${prefix}\\`)
        )
      ).length;
    },

    async removeUnder(directories: string[]): Promise<number> {
      if (directories.length === 0) return 0;
      const prefixes = directories.map((dir) => dir.replace(/[\\/]+$/, ''));
      const doomed = files.filter((file) =>
        !file.protected && prefixes.some((prefix) =>
          file.path === prefix || file.path.startsWith(`${prefix}/`) || file.path.startsWith(`${prefix}\\`)
        )
      );
      if (doomed.length === 0) return 0;
      const ids = new Set(doomed.map((file) => file.id));
      files = files.filter((file) => !ids.has(file.id));
      await persist();
      return doomed.length;
    },

    async move(id: string, folder: string) {
      if (files.find(f => f.id === id)?.protected) return;
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
      if (isProtectedFolder(path)) return;
      folders = folders.filter(f => f !== path && !f.startsWith(path + '/'));
      files = files.map(f =>
        (f.folder === path || f.folder.startsWith(path + '/')) ? { ...f, folder: '' } : f
      );
      await persist();
    },

    async renameFolder(oldPath: string, newPath: string) {
      if (isProtectedFolder(oldPath)) return;
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
      const api = liatir();
      if (!api) return;
      const result = await api.desktop.files.open({ multi: true });
      for (const path of result?.paths ?? []) {
        await this.add(path, folder);
      }
    },

    async addSampleFastq(folder = '') {
      const api = liatir();
      if (!api) return;
      const path = (await api.invoke('lia_fastqc_sample_path')) as string | null;
      if (path) await this.add(path, folder);
    },

    async checkMissing() {
      const api = liatir();
      if (!api) return;
      const results = await Promise.all(
        files.map(async (f) => {
          try {
            await api.invoke('lia_file_size', { path: f.path });
            return { id: f.id, missing: false };
          } catch {
            return { id: f.id, missing: true };
          }
        })
      );
      const anyChange = results.some(r => {
        const f = files.find(x => x.id === r.id);
        return f && !!f.missing !== r.missing;
      });
      if (anyChange) {
        files = files.map(f => {
          const r = results.find(x => x.id === f.id);
          return r ? { ...f, missing: r.missing } : f;
        });
      }
    },

    async relocate(id: string) {
      const api = liatir();
      if (!api) return;
      const result = await api.desktop.files.open({ multi: false });
      const newPath = result?.paths?.[0];
      if (!newPath) return;
      const name = newPath.split(/[\\/]/).pop() ?? newPath;
      let size: number | undefined;
      try { size = (await api.invoke('lia_file_size', { path: newPath })) as number; } catch { /* ok */ }
      const current = files.find(file => file.id === id);
      let scientific: LiatirScientificArtifactMetadata | undefined;
      if (detectExt(newPath) === 'h5ad') {
        try {
          const inspected = await inspectAnnDataArtifact(newPath);
          scientific = current?.scientific?.physical.artifactId === inspected.physical.artifactId
            ? current.scientific
            : inspected;
        } catch {
          scientific = undefined;
        }
      }
      files = files.map(f =>
        f.id === id
          ? {
              ...f,
              path: newPath,
              name,
              ext: detectExt(newPath),
              size,
              missing: false,
              ...(scientific ? { scientific } : { scientific: undefined }),
            }
          : f
      );
      await persist();
    },
  };
}

export const dataFiles = createDataFilesStore();
