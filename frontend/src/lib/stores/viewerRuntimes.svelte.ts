import { liatir } from '$lib/api';
import {
  VIEWER_RUNTIME_REGISTRY,
  type ViewerRuntimeCapability,
  type ViewerRuntimeRecord,
  type ViewerRuntimeStatus,
} from '$lib/viewers/runtime-registry';
import { appStorage } from './app-storage';

interface StoredViewerRuntimeState {
  status?: ViewerRuntimeStatus;
  localPath?: string;
  entryPath?: string;
  updatedAt?: number;
  error?: string;
}

interface ViewerRuntimeStateFile {
  runtimes: Record<string, StoredViewerRuntimeState>;
}

export interface ViewerRuntimeInstallProgress {
  phase: 'downloading-files' | 'done';
  fileIndex: number;
  fileCount: number;
  bytesDownloaded: number;
  bytesTotal: number | null;
}

const VIEWER_RUNTIMES_FILE = 'viewer-runtimes.json';
const VIEWER_RUNTIME_MARKER_DIR = 'viewer-runtime-installs';

function getInstallMarkerFile(runtimeId: string) {
  return `${VIEWER_RUNTIME_MARKER_DIR}/${runtimeId}.json`;
}

function defaultState(): StoredViewerRuntimeState {
  return {
    status: 'available',
  };
}

function createViewerRuntimesStore() {
  let initialized = false;
  let runtimeStates = $state<Record<string, StoredViewerRuntimeState>>({});

  function allRuntimeIds(): Set<string> {
    return new Set(VIEWER_RUNTIME_REGISTRY.map((runtime) => runtime.id));
  }

  function records(): ViewerRuntimeRecord[] {
    return VIEWER_RUNTIME_REGISTRY.map((runtime) => {
      const state = { ...defaultState(), ...(runtimeStates[runtime.id] ?? {}) };
      return {
        ...runtime,
        status: state.status ?? 'available',
        localPath: state.localPath,
        entryPath: state.entryPath,
        updatedAt: state.updatedAt,
        error: state.error,
      };
    });
  }

  async function persist() {
    const state: ViewerRuntimeStateFile = { runtimes: runtimeStates };
    await appStorage.writeText(VIEWER_RUNTIMES_FILE, JSON.stringify(state, null, 2), { createDirs: true });
  }

  function safeInstallRelativePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error(`Unsafe viewer runtime install file path: ${relativePath}`);
    }
    return normalized;
  }

  async function existingFileMatches(
    api: NonNullable<ReturnType<typeof liatir>>,
    path: string,
    expectedSize?: number,
  ): Promise<boolean> {
    try {
      const size = (await api.invoke('lia_file_size', { path })) as number;
      return expectedSize == null ? size > 0 : size === expectedSize;
    } catch {
      return false;
    }
  }

  return {
    get initialized() { return initialized; },
    get runtimes() { return records(); },

    byId(id: string): ViewerRuntimeRecord | null {
      return records().find((runtime) => runtime.id === id) ?? null;
    },

    byCapability(capability: ViewerRuntimeCapability): ViewerRuntimeRecord[] {
      return records().filter((runtime) => runtime.capability === capability);
    },

    async init() {
      if (initialized) return;
      initialized = true;
      runtimeStates = {};
      if (!liatir()) return;

      try {
        if (await appStorage.exists(VIEWER_RUNTIMES_FILE)) {
          const raw = await appStorage.readText(VIEWER_RUNTIMES_FILE);
          const parsed = JSON.parse(raw) as Partial<ViewerRuntimeStateFile>;
          runtimeStates = parsed.runtimes ?? {};
        }
      } catch {
        runtimeStates = {};
      }

      for (const runtime of VIEWER_RUNTIME_REGISTRY) {
        if (runtime.install.kind !== 'managed-script') continue;
        try {
          const markerFile = getInstallMarkerFile(runtime.id);
          if (!await appStorage.exists(markerFile)) continue;
          const marker = JSON.parse(await appStorage.readText(markerFile)) as StoredViewerRuntimeState;
          runtimeStates = {
            ...runtimeStates,
            [runtime.id]: {
              ...defaultState(),
              ...(runtimeStates[runtime.id] ?? {}),
              ...marker,
              status: 'installed',
            },
          };
        } catch { /* marker recovery is best-effort */ }
      }
    },

    async setRuntimeState(id: string, patch: StoredViewerRuntimeState) {
      if (!allRuntimeIds().has(id)) return;
      runtimeStates = {
        ...runtimeStates,
        [id]: {
          ...defaultState(),
          ...(runtimeStates[id] ?? {}),
          ...patch,
          updatedAt: Date.now(),
        },
      };
      await persist();
    },

    async installManagedRuntime(
      id: string,
      onProgress?: (progress: ViewerRuntimeInstallProgress) => void,
    ): Promise<ViewerRuntimeRecord> {
      const api = liatir();
      if (!api) throw new Error('Liatir API not available');
      const runtime = VIEWER_RUNTIME_REGISTRY.find((item) => item.id === id);
      if (!runtime) throw new Error(`Unknown viewer runtime: ${id}`);
      if (runtime.install.kind !== 'managed-script') {
        throw new Error(`${runtime.name} is not installable in this build yet.`);
      }

      const files = runtime.install.files ?? [];
      if (files.length === 0 || !runtime.install.entryFile) {
        throw new Error(`${runtime.name} has no managed files.`);
      }

      const dataPath = await api.desktop.fs.data.path();
      const runtimeDir = `${dataPath}/viewer-runtimes/managed/${id}`;

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const relativePath = safeInstallRelativePath(file.relativePath);
        const downloadId = `${id}-${index}-${crypto.randomUUID()}`;
        const destPath = `${runtimeDir}/${relativePath}`;
        if (await existingFileMatches(api, destPath, file.sizeBytes)) {
          onProgress?.({
            phase: 'downloading-files',
            fileIndex: index,
            fileCount: files.length,
            bytesDownloaded: file.sizeBytes ?? 0,
            bytesTotal: file.sizeBytes ?? null,
          });
          continue;
        }
        const unlisten = await api.desktop.events.on(
          `managed:progress:${downloadId}`,
          (p: { bytesDownloaded: number; bytesTotal: number | null }) => {
            onProgress?.({
              phase: 'downloading-files',
              fileIndex: index,
              fileCount: files.length,
              bytesDownloaded: p.bytesDownloaded,
              bytesTotal: p.bytesTotal,
            });
          },
        );
        try {
          await api.invoke('lia_managed_download', {
            id: downloadId,
            url: file.url,
            destPath,
            sha256: file.sha256 ?? null,
          });
        } finally {
          unlisten();
        }
      }

      const entryPath = `${runtimeDir}/${safeInstallRelativePath(runtime.install.entryFile)}`;
      await this.setRuntimeState(id, {
        status: 'installed',
        localPath: runtimeDir,
        entryPath,
        error: undefined,
      });
      await appStorage.writeText(getInstallMarkerFile(id), JSON.stringify({
        status: 'installed',
        localPath: runtimeDir,
        entryPath,
        updatedAt: Date.now(),
      }, null, 2), { createDirs: true });
      onProgress?.({
        phase: 'done',
        fileIndex: files.length,
        fileCount: files.length,
        bytesDownloaded: 0,
        bytesTotal: null,
      });
      return this.byId(id)!;
    },

    async removeManagedRuntime(id: string) {
      const api = liatir();
      if (!api) return;
      const runtime = this.byId(id);
      if (!runtime || runtime.install.kind !== 'managed-script') return;
      if (runtime.localPath) {
        await api.invoke('lia_managed_remove', { path: runtime.localPath, recursive: true }).catch(() => {});
      }
      const { [id]: _removed, ...restStates } = runtimeStates;
      runtimeStates = restStates;
      await appStorage.remove(getInstallMarkerFile(id)).catch(() => {});
      await persist();
    },

    reset() {
      initialized = false;
      runtimeStates = {};
    },
  };
}

export const viewerRuntimesStore = createViewerRuntimesStore();
