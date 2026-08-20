/**
 * Store for viewer runtimes — the heavy JavaScript libraries that render scientific data
 * (molecular structures, genome browsers, single-cell plots).
 *
 * They are installed on demand rather than bundled: each is megabytes of code that most users
 * never open, and shipping them all would inflate the app for everyone. So a viewer's library is
 * downloaded the first time it is actually needed.
 *
 * The shape deliberately mirrors [`aiModels.svelte.ts`]: state persisted in an aggregate file plus
 * a durable per-runtime install marker, installs de-duplicated per ID, and a registry that is the
 * source of truth for *what* exists while this store only tracks what is installed. Same problem,
 * same solution — a viewer library is just a much smaller download than a model.
 */
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

/** Aggregate state for all viewer runtimes. */
const VIEWER_RUNTIMES_FILE = 'viewer-runtimes.json';
/** One marker per installed runtime — the durable record that survives a lost aggregate file. */
const VIEWER_RUNTIME_MARKER_DIR = 'viewer-runtime-installs';

function getInstallMarkerFile(runtimeId: string) {
  return `${VIEWER_RUNTIME_MARKER_DIR}/${runtimeId}.json`;
}

function defaultState(): StoredViewerRuntimeState {
  return {
    status: 'available',
  };
}

/**
 * Whether a runtime's recorded entry file is still on disk.
 *
 * An install marker records that an install *finished*, not that its payload is still there. A
 * sandbox reset or an uninstall moves the runtime directory to the trash and leaves the marker
 * behind, so the store reported the runtime as installed and the viewer then failed reading it —
 * surfacing a raw `No such file or directory (os error 2)` to a user who was never told a runtime
 * was missing. The marker is deliberately not deleted: restoring the directory from the trash
 * makes the runtime usable again, and a probe per managed runtime at init costs nothing.
 */
async function entryFileExists(path: string | undefined): Promise<boolean> {
  if (!path) return false;
  const api = liatir();
  if (!api) return false;
  try {
    await api.invoke('lia_file_size', { path });
    return true;
  } catch {
    return false;
  }
}

function createViewerRuntimesStore() {
  let initialized = false;
  let runtimeStates = $state<Record<string, StoredViewerRuntimeState>>({});
  /** Progress keyed by runtime ID, so installing one viewer never blocks the UI of another. */
  let installProgress = $state<Record<string, ViewerRuntimeInstallProgress>>({});
  /** Single-flight per runtime: two components needing the same viewer share one install. */
  const installPromises = new Map<string, Promise<ViewerRuntimeRecord>>();

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

  /** Registry-supplied paths are joined onto the runtime directory, so reject anything that escapes it. */
  function safeInstallRelativePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error(`Unsafe viewer runtime install file path: ${relativePath}`);
    }
    return normalized;
  }

  /**
   * Whether the file is already on disk at the expected size — which makes a re-run of a partially
   * completed install skip what it already has. Any error means "cannot confirm", so it downloads.
   */
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
    get installProgress() { return installProgress; },

    byId(id: string): ViewerRuntimeRecord | null {
      return records().find((runtime) => runtime.id === id) ?? null;
    },

    /**
     * Runtimes able to render a given kind of data. Callers ask by *capability* ("show me a protein
     * structure") rather than by name, so the concrete library backing a viewer can be swapped
     * without touching the components that use it.
     */
    byCapability(capability: ViewerRuntimeCapability): ViewerRuntimeRecord[] {
      return records().filter((runtime) => runtime.capability === capability);
    },

    /**
     * Loads persisted state, then lets the install markers override it — same precedence rule as the
     * AI Models store: a marker only exists if an install actually finished, so it is the harder
     * evidence and wins over a possibly stale aggregate file.
     */
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

      // Neither source of "installed" proves the payload survived, so verify it before the UI can
      // offer a viewer that cannot load. A runtime whose entry file is gone is offered for install
      // again, which is the state the user is actually in.
      for (const runtime of VIEWER_RUNTIME_REGISTRY) {
        if (runtime.install.kind !== 'managed-script') continue;
        const state = runtimeStates[runtime.id];
        if (state?.status !== 'installed') continue;
        if (await entryFileExists(state.entryPath)) continue;
        runtimeStates = {
          ...runtimeStates,
          [runtime.id]: { ...defaultState(), updatedAt: state.updatedAt },
        };
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

    /**
     * Downloads a viewer's library files and records it as installed.
     *
     * Typically triggered by opening a result that needs the viewer, which means several components
     * can request the same runtime at once — hence the single-flight guard, which turns concurrent
     * requests into one download rather than several racing to write the same files.
     */
    async installManagedRuntime(
      id: string,
      onProgress?: (progress: ViewerRuntimeInstallProgress) => void,
    ): Promise<ViewerRuntimeRecord> {
      const existingInstall = installPromises.get(id);
      if (existingInstall) return existingInstall;

      const api = liatir();
      if (!api) throw new Error('Liatir API not available');
      const runtime = VIEWER_RUNTIME_REGISTRY.find((item) => item.id === id);
      if (!runtime) throw new Error(`Unknown viewer runtime: ${id}`);
      if (runtime.install.kind !== 'managed-script') {
        throw new Error(`${runtime.name} is not installable in this build yet.`);
      }

      const files = runtime.install.files ?? [];
      const entryFile = runtime.install.entryFile;
      if (files.length === 0 || !entryFile) {
        throw new Error(`${runtime.name} has no managed files.`);
      }

      const dataPath = await api.desktop.fs.data.path();
      const runtimeDir = `${dataPath}/viewer-runtimes/managed/${id}`;

      const emitProgress = (progress: ViewerRuntimeInstallProgress) => {
        installProgress = {
          ...installProgress,
          [id]: progress,
        };
        onProgress?.(progress);
      };

      const installPromise = (async () => {
        emitProgress({
          phase: 'downloading-files',
          fileIndex: 0,
          fileCount: files.length,
          bytesDownloaded: 0,
          bytesTotal: null,
        });

        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          const relativePath = safeInstallRelativePath(file.relativePath);
          const downloadId = `${id}-${index}-${crypto.randomUUID()}`;
          const destPath = `${runtimeDir}/${relativePath}`;
          if (await existingFileMatches(api, destPath, file.sizeBytes)) {
            emitProgress({
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
              emitProgress({
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

        // The entry file is the script the loader will actually import; resolving it once here means
        // the viewer component never has to know the runtime's internal layout.
        const entryPath = `${runtimeDir}/${safeInstallRelativePath(entryFile)}`;
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
        emitProgress({
          phase: 'done',
          fileIndex: files.length,
          fileCount: files.length,
          bytesDownloaded: 0,
          bytesTotal: null,
        });
        return this.byId(id)!;
      })().finally(() => {
        // Always release the single-flight slot and clear the progress entry, success or failure —
        // otherwise a failed install would be permanently unretryable and leave a stuck progress bar.
        installPromises.delete(id);
        const { [id]: _done, ...rest } = installProgress;
        installProgress = rest;
      });

      installPromises.set(id, installPromise);
      return installPromise;
    },

    /** Deletes a viewer's downloaded files and forgets it, marker included. */
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
      // The marker must go too, or the next startup would resurrect this runtime as installed.
      await appStorage.remove(getInstallMarkerFile(id)).catch(() => {});
      await persist();
    },

    reset() {
      initialized = false;
      runtimeStates = {};
      installProgress = {};
      installPromises.clear();
    },
  };
}

export const viewerRuntimesStore = createViewerRuntimesStore();
