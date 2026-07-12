/**
 * Store for locally installed AI Models.
 *
 * Ownership: AI Models are a **machine-level** resource, not a per-workspace one. They are
 * multi-gigabyte assets and several workspaces routinely use the same model, so installing one
 * makes it available everywhere. (Earlier versions kept them per workspace; see
 * `migrateLegacyWorkspaceInstalls` below, which promotes those old installs to the global scope.)
 *
 * Installed state is recorded in two places on purpose:
 *   - `ai-models.json`                  — the aggregate state for every model;
 *   - `ai-model-installs/<id>.json`     — one durable marker per installed model.
 *
 * The marker is the authority on "is this really installed". On startup a marker promotes its
 * model to `installed` even if the aggregate file has lost or never recorded it, so a corrupted or
 * truncated `ai-models.json` cannot make the user re-download gigabytes that are already on disk.
 *
 * Concurrency: every long operation is keyed by model ID — the in-flight install promises, the
 * per-model runtime checks, the progress and log entries. Installing one model therefore never
 * blocks the UI for another, and two clicks on the same model share a single install rather than
 * starting two.
 */
import { liatir } from '$lib/api';
import {
  MOCK_AI_MODEL_ID,
  VISIBLE_LOCAL_AI_MODEL_REGISTRY,
} from '$lib/ai/model-registry';
import { modelInstallBlock } from '$lib/ai/model-compatibility';
import { preloadManagedAIModel } from '$lib/ai/model-preload';
import {
  cachePathForModel,
  getAIHardwareInfo,
  getAIRuntimeStatus,
  installAIRuntimeBox,
  prepareAIRuntime,
  removeAIRuntime,
  runtimeIdForModel,
  type AIHardwareInfo,
} from '$lib/ai/runtime';
import { appStorage } from './app-storage';
import { SANDBOX_WORKSPACE_ID, workspaceStore } from './workspace.svelte';
import type {
  LiatirAIModelInstallFile,
  LiatirAIModelMetadata,
  LiatirAIModelRecord,
  LiatirAIModelStatus,
  LiatirPythonRuntimeLock,
} from '@liatir/core';

/** Aggregate state for every model, rewritten on each change. */
const AI_MODELS_FILE = 'ai-models.json';
/** One marker file per installed model — the durable record that survives a lost aggregate file. */
const AI_MODEL_INSTALL_MARKER_DIR = 'ai-model-installs';
/** Presence of this file means the one-off migration below has already run. */
const LEGACY_AI_MODELS_WORKSPACE_MIGRATION_FILE = 'ai-models-workspace-migration.json';
const WORKSPACES_FILE = 'workspaces.json';

/** What is persisted per model. Everything else in a record comes from the static registry. */
interface StoredAIModelState {
  status?: LiatirAIModelStatus;
  localPath?: string;
  runtimePath?: string;
  cachePath?: string;
  installedSizeBytes?: number;
  runtimeSizeBytes?: number;
  cacheSizeBytes?: number;
  runtimeLock?: LiatirPythonRuntimeLock;
  enabled?: boolean;
  updatedAt?: number;
  error?: string;
}

interface AIModelsState {
  modelStates: Record<string, StoredAIModelState>;
}

interface WorkspacesState {
  workspaces?: Array<{ id?: string | null }>;
}

export interface AIModelInstallProgress {
  phase?: 'preparing-runtime' | 'installing-packages' | 'downloading-model' | 'downloading-files';
  fileIndex: number;
  fileCount: number;
  bytesDownloaded: number;
  bytesTotal: number | null;
  message?: string;
  logLines?: string[];
}

/** Live progress of an install that is currently running. */
export type AIModelInstallState = AIModelInstallProgress & {
  showLog: boolean;
  logLines: string[];
  startedAt: number;
};

/**
 * The log of an install that has *finished*.
 *
 * Kept after the install completes so the user can still read what happened — especially the
 * output of a failed one, which would otherwise vanish the instant the progress entry is cleared.
 */
export interface AIModelInstallLogState {
  showLog: boolean;
  logLines: string[];
  finishedAt: number;
  status: 'done' | 'error';
}

function getFile() { return AI_MODELS_FILE; }
function getInstallMarkerFile(modelId: string) {
  return `${AI_MODEL_INSTALL_MARKER_DIR}/${modelId}.json`;
}

function getLegacyWorkspaceFile(workspaceId: string) {
  return `workspaces/${workspaceId}/ai-models.json`;
}

function getLegacyWorkspaceInstallMarkerFile(workspaceId: string, modelId: string) {
  return `workspaces/${workspaceId}/ai-model-installs/${modelId}.json`;
}

function getLegacyWorkspaceInstallMarkerDir(workspaceId: string) {
  return `workspaces/${workspaceId}/ai-model-installs`;
}

/** The mock model needs no installing — it exists to exercise the pipeline in the dev sandbox. */
function defaultStateFor(modelId: string): StoredAIModelState {
  return {
    status: modelId === MOCK_AI_MODEL_ID ? 'installed' : 'available',
    enabled: true,
  };
}

/**
 * True for the two methods backed by a Python environment. They differ in how that environment is
 * obtained — built locally, or downloaded pre-built and signed — but both can be *inspected* the
 * same way afterwards, which is what the runtime-status refresh relies on.
 */
function usesManagedPythonRuntime(model: LiatirAIModelMetadata): boolean {
  return model.install?.method === 'managed-runtime' || model.install?.method === 'runtime-box';
}

function createAIModelsStore() {
  let initialized = false;
  let modelStates = $state<Record<string, StoredAIModelState>>({});
  /** Per-model "currently inspecting the runtime" flags, so one check cannot disable other models. */
  let runtimeChecks = $state<Record<string, boolean>>({});
  let runtimeStatusesChecked = $state(false);
  let runtimeStatusRefreshing = $state(false);
  let hardwareInfo = $state<AIHardwareInfo | null>(null);
  let hardwareInfoChecked = $state(false);
  let hardwareInfoLoading = $state(false);
  /** Installs in flight, keyed by model ID. */
  let installing = $state<Record<string, AIModelInstallState>>({});
  /** Logs of installs that have finished; see AIModelInstallLogState. */
  let installLogs = $state<Record<string, AIModelInstallLogState>>({});
  // These three are single-flight guards, not reactive state: they exist so that N callers asking
  // for the same work get the one in-flight promise instead of each starting a duplicate job.
  let runtimeStatusRefreshPromise: Promise<void> | null = null;
  let hardwareInfoPromise: Promise<AIHardwareInfo | null> | null = null;
  const installPromises = new Map<string, Promise<LiatirAIModelRecord>>();

  function allModelIds(): Set<string> {
    return new Set(VISIBLE_LOCAL_AI_MODEL_REGISTRY.map((model) => model.id));
  }

  /**
   * The registry is the source of truth for *what* models exist; this store only tracks their
   * local state. A record is the two merged, so a model the user has never touched still appears
   * with sensible defaults.
   */
  function records(): LiatirAIModelRecord[] {
    return VISIBLE_LOCAL_AI_MODEL_REGISTRY.filter((metadata) =>
      // The mock model is only ever shown inside the plugin-dev sandbox.
      metadata.id !== MOCK_AI_MODEL_ID || workspaceStore.isSandboxMode
    ).map((metadata) => {
      const state = { ...defaultStateFor(metadata.id), ...(modelStates[metadata.id] ?? {}) };
      return {
        ...metadata,
        status: state.status ?? 'available',
        localPath: state.localPath,
        runtimePath: state.runtimePath,
        cachePath: state.cachePath,
        installedSizeBytes: state.installedSizeBytes,
        runtimeSizeBytes: state.runtimeSizeBytes,
        cacheSizeBytes: state.cacheSizeBytes,
        runtimeLock: state.runtimeLock,
        enabled: state.enabled ?? true,
        updatedAt: state.updatedAt,
        error: state.error,
      };
    });
  }

  function setRuntimeChecking(id: string, checking: boolean) {
    if (!allModelIds().has(id)) return;
    if (checking) {
      runtimeChecks = {
        ...runtimeChecks,
        [id]: true,
      };
      return;
    }
    const { [id]: _done, ...rest } = runtimeChecks;
    runtimeChecks = rest;
  }

  function updateInstallProgress(id: string, progress: AIModelInstallProgress) {
    if (!allModelIds().has(id)) return;
    const current = installing[id];
    installing = {
      ...installing,
      [id]: {
        phase: progress.phase ?? current?.phase,
        fileIndex: progress.fileIndex,
        fileCount: progress.fileCount,
        bytesDownloaded: progress.bytesDownloaded,
        bytesTotal: progress.bytesTotal,
        message: progress.message ?? current?.message,
        showLog: current?.showLog ?? true,
        logLines: [...(current?.logLines ?? []), ...(progress.logLines ?? [])],
        startedAt: current?.startedAt ?? Date.now(),
      },
    };
  }

  function clearInstallLog(id: string) {
    const { [id]: _oldLog, ...restLogs } = installLogs;
    installLogs = restLogs;
  }

  function startInstall(id: string, progress: AIModelInstallProgress) {
    clearInstallLog(id);
    installing = {
      ...installing,
      [id]: {
        ...progress,
        showLog: true,
        logLines: progress.logLines ?? [],
        startedAt: Date.now(),
      },
    };
  }

  /**
   * Ends an install: the accumulated log is moved from `installing` into `installLogs` before the
   * progress entry is dropped. Without that hand-off the output of a failed install — the one the
   * user most needs to read — would disappear at the moment it failed.
   */
  function finishInstall(id: string, status: AIModelInstallLogState['status'], logLine?: string) {
    const current = installing[id];
    if (current) {
      const logLines = [...current.logLines, ...(logLine ? [logLine] : [])];
      if (logLines.length > 0) {
        installLogs = {
          ...installLogs,
          [id]: {
            showLog: true,
            logLines,
            finishedAt: Date.now(),
            status,
          },
        };
      }
    }
    const { [id]: _done, ...rest } = installing;
    installing = rest;
  }

  function emitInstallProgress(
    id: string,
    progress: AIModelInstallProgress,
    onProgress?: (progress: AIModelInstallProgress) => void,
  ) {
    updateInstallProgress(id, progress);
    onProgress?.(progress);
  }

  async function persist() {
    const state: AIModelsState = { modelStates };
    await appStorage.writeText(getFile(), JSON.stringify(state, null, 2), { createDirs: true });
  }

  /**
   * Guards the per-file paths declared in a model's registry entry. They are joined onto the
   * model's install directory, so an absolute path or a `..` segment would let a registry entry
   * write anywhere on disk.
   */
  function safeInstallRelativePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error(`Unsafe AI Model install file path: ${relativePath}`);
    }
    return normalized;
  }

  /**
   * Whether a file on disk already *is* the file we were about to download.
   *
   * This makes an interrupted install resumable: re-running it skips whatever completed and
   * verified last time, instead of re-fetching gigabytes. The check is by size and, when the
   * registry declares one, SHA-256 — so a truncated or corrupted leftover is not mistaken for a
   * finished download. Any error means "cannot confirm", which safely falls back to downloading.
   */
  async function existingFileMatches(
    api: ReturnType<typeof liatir>,
    path: string,
    expectedSize?: number,
    expectedSha256?: string
  ): Promise<boolean> {
    if (!api) return false;
    try {
      const size = (await api.invoke('lia_file_size', { path })) as number;
      // With no declared size, any non-empty file counts; otherwise it must match exactly.
      if (expectedSize == null ? size <= 0 : size !== expectedSize) return false;
      if (!expectedSha256) return true;
      return (await api.invoke('lia_managed_verify_sha256', {
        path,
        expected: expectedSha256,
      })) as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Downloads a model's declared files one at a time, reporting progress per file.
   *
   * Sequential rather than parallel: these are large files, and saturating the connection with
   * several at once mostly makes the progress bar less honest without finishing sooner.
   */
  async function downloadInstallFiles(
    api: NonNullable<ReturnType<typeof liatir>>,
    modelId: string,
    files: LiatirAIModelInstallFile[],
    baseDir: string,
    onProgress?: (progress: AIModelInstallProgress) => void
  ): Promise<void> {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const relativePath = safeInstallRelativePath(file.relativePath);
      const downloadId = `${modelId}-${index}-${crypto.randomUUID()}`;
      const destPath = `${baseDir}/${relativePath}`;
      if (await existingFileMatches(api, destPath, file.sizeBytes, file.sha256)) {
        onProgress?.({
          phase: 'downloading-files',
          fileIndex: index,
          fileCount: files.length,
          bytesDownloaded: file.sizeBytes ?? 0,
          bytesTotal: file.sizeBytes ?? null,
          logLines: [`Skipping existing ${relativePath}`],
        });
        continue;
      }
      onProgress?.({
        phase: 'downloading-files',
        fileIndex: index,
        fileCount: files.length,
        bytesDownloaded: 0,
        bytesTotal: file.sizeBytes ?? null,
        logLines: [`Downloading ${relativePath}`],
      });
      // Progress arrives as backend events on a channel named after this download's unique ID,
      // which is what keeps concurrent downloads from reporting into each other's progress bars.
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
        }
      );
      try {
        // The backend verifies the SHA-256 while streaming, so a corrupted download fails here
        // rather than surfacing later as an unexplainable model error.
        await api.invoke('lia_managed_download', {
          id: downloadId,
          url: file.url,
          destPath,
          sha256: file.sha256 ?? null,
        });
      } finally {
        // Always detach the listener, or a failed download would leak it.
        unlisten();
      }
    }
  }

  async function readStoredStateFile(file: string): Promise<Record<string, StoredAIModelState>> {
    if (!await appStorage.exists(file)) return {};
    const raw = await appStorage.readText(file);
    const parsed = JSON.parse(raw) as Partial<AIModelsState>;
    return parsed.modelStates ?? {};
  }

  async function readLegacyWorkspaceIds(): Promise<string[]> {
    const ids = new Set<string>([SANDBOX_WORKSPACE_ID]);
    try {
      if (await appStorage.exists(WORKSPACES_FILE)) {
        const raw = await appStorage.readText(WORKSPACES_FILE);
        const parsed = JSON.parse(raw) as WorkspacesState;
        for (const workspace of parsed.workspaces ?? []) {
          if (workspace.id) ids.add(workspace.id);
        }
      }
    } catch { /* legacy recovery is best-effort */ }
    return [...ids];
  }

  /**
   * Adopts an `installed` state found in a legacy location into the global one, and writes the
   * marker file that makes it durable from now on. Only `installed` states are worth recovering —
   * anything else can simply be recomputed.
   */
  async function promoteInstalledState(id: string, state: StoredAIModelState): Promise<boolean> {
    if (!allModelIds().has(id) || state.status !== 'installed') return false;
    const promoted = {
      ...defaultStateFor(id),
      ...(modelStates[id] ?? {}),
      ...state,
      status: 'installed' as const,
      enabled: state.enabled ?? modelStates[id]?.enabled ?? true,
      updatedAt: state.updatedAt ?? Date.now(),
    };
    modelStates = {
      ...modelStates,
      [id]: promoted,
    };
    await appStorage.writeText(getInstallMarkerFile(id), JSON.stringify(promoted, null, 2), { createDirs: true });
    return true;
  }

  /**
   * One-off migration from the old per-workspace layout to the global one.
   *
   * AI Models used to be recorded inside each workspace. Left alone, a user upgrading would see
   * every model as "not installed" and be asked to re-download many gigabytes that are already on
   * their disk. So each workspace's old state is scanned, any `installed` entry is promoted to the
   * global scope, and the stale files are cleared away.
   *
   * Every step is best-effort and swallows its errors: this runs at startup, and a malformed
   * leftover file from an old version must not be able to prevent the app from opening. The marker
   * file at the end makes it run at most once.
   */
  async function migrateLegacyWorkspaceInstalls(): Promise<boolean> {
    try {
      if (await appStorage.exists(LEGACY_AI_MODELS_WORKSPACE_MIGRATION_FILE)) return false;
    } catch {
      return false;
    }

    let recovered = false;
    const workspaceIds = await readLegacyWorkspaceIds();
    for (const workspaceId of workspaceIds) {
      try {
        const states = await readStoredStateFile(getLegacyWorkspaceFile(workspaceId));
        for (const [id, state] of Object.entries(states)) {
          recovered = await promoteInstalledState(id, state) || recovered;
        }
      } catch { /* legacy recovery is best-effort */ }

      for (const metadata of VISIBLE_LOCAL_AI_MODEL_REGISTRY) {
        try {
          const markerFile = getLegacyWorkspaceInstallMarkerFile(workspaceId, metadata.id);
          if (!await appStorage.exists(markerFile)) continue;
          const marker = JSON.parse(await appStorage.readText(markerFile)) as StoredAIModelState;
          recovered = await promoteInstalledState(metadata.id, marker) || recovered;
        } catch { /* legacy marker recovery is best-effort */ }
      }

      try { await appStorage.remove(getLegacyWorkspaceFile(workspaceId)).catch(() => {}); } catch { /* best effort */ }
      try { await appStorage.remove(getLegacyWorkspaceInstallMarkerDir(workspaceId), true).catch(() => {}); } catch { /* best effort */ }
    }

    try {
      await appStorage.writeText(
        LEGACY_AI_MODELS_WORKSPACE_MIGRATION_FILE,
        JSON.stringify({ migratedAt: Date.now() }, null, 2),
        { createDirs: true },
      );
    } catch { /* best effort */ }

    if (recovered) await persist();
    return recovered;
  }

  return {
    get initialized() { return initialized; },
    get models() { return records(); },
    get runtimeChecks() { return runtimeChecks; },
    get runtimeStatusesChecked() { return runtimeStatusesChecked; },
    get runtimeStatusRefreshing() { return runtimeStatusRefreshing; },
    get hardwareInfo() { return hardwareInfo; },
    get hardwareInfoChecked() { return hardwareInfoChecked; },
    get hardwareInfoLoading() { return hardwareInfoLoading; },
    get installing() { return installing; },
    get installLogs() { return installLogs; },
    /**
     * Models the rest of the app may actually run: released, enabled, installed, and not currently
     * mid-check. Excluding models under inspection avoids handing a caller a runtime that is about
     * to be reported as broken.
     */
    get runnableModels() {
      return records().filter((model) =>
        model.releaseStage !== 'preview' && model.enabled !== false && model.status === 'installed' && !runtimeChecks[model.id]
      );
    },
    /**
     * Loads persisted state, then lets the install markers have the last word.
     *
     * Order matters: the aggregate file is read first and the markers are layered on top, forcing
     * `status: 'installed'`. That is what makes a model whose marker exists show as installed even
     * if the aggregate file is missing, stale or unparseable — the marker is the harder evidence,
     * since it is only ever written after an install actually succeeded.
     */
    async init() {
      const file = getFile();
      if (initialized) return;
      initialized = true;
      modelStates = {};
      // Outside the desktop app (e.g. a browser preview) there is no storage to read.
      if (!liatir()) return;
      try {
        modelStates = await readStoredStateFile(file);
      } catch {
        // A corrupted aggregate file is not fatal — the markers below can rebuild what matters.
        modelStates = {};
      }

      for (const metadata of VISIBLE_LOCAL_AI_MODEL_REGISTRY) {
        if (metadata.install?.method !== 'managed-runtime'
          && metadata.install?.method !== 'runtime-box'
          && metadata.install?.method !== 'managed-download') continue;
        try {
          const markerFile = getInstallMarkerFile(metadata.id);
          if (!await appStorage.exists(markerFile)) continue;
          const raw = await appStorage.readText(markerFile);
          const marker = JSON.parse(raw) as StoredAIModelState;
          modelStates = {
            ...modelStates,
            [metadata.id]: {
              ...defaultStateFor(metadata.id),
              ...(modelStates[metadata.id] ?? {}),
              ...marker,
              status: 'installed',
              // `enabled` is a user preference, so keep whatever was set rather than resetting it.
              enabled: marker.enabled ?? modelStates[metadata.id]?.enabled ?? true,
            },
          };
        } catch { /* marker recovery is best-effort */ }
      }

      await migrateLegacyWorkspaceInstalls();
    },

    /**
     * Probes the host once and caches the result.
     *
     * Two levels of guard: `hardwareInfoChecked` skips the work entirely on later calls, and
     * `hardwareInfoPromise` makes simultaneous callers share the *same* in-flight probe rather than
     * each spawning their own. A failed probe caches `null` — "we asked and could not tell" — which
     * callers treat as unknown rather than retrying on every render.
     */
    async ensureHardwareInfo(options: { force?: boolean } = {}): Promise<AIHardwareInfo | null> {
      if (!options.force && hardwareInfoChecked) return hardwareInfo;
      if (hardwareInfoPromise) return hardwareInfoPromise;

      hardwareInfoLoading = true;
      hardwareInfoPromise = getAIHardwareInfo()
        .then((info) => {
          hardwareInfo = info;
          hardwareInfoChecked = true;
          return info;
        })
        .catch(() => {
          hardwareInfo = null;
          hardwareInfoChecked = true;
          return null;
        })
        .finally(() => {
          hardwareInfoLoading = false;
          hardwareInfoPromise = null;
        });
      return hardwareInfoPromise;
    },

    byId(id: string): LiatirAIModelRecord | null {
      return records().find((model) => model.id === id) ?? null;
    },

    async setModelState(id: string, patch: StoredAIModelState) {
      if (!allModelIds().has(id)) return;
      modelStates = {
        ...modelStates,
        [id]: {
          ...defaultStateFor(id),
          ...(modelStates[id] ?? {}),
          ...patch,
          updatedAt: Date.now(),
        },
      };
      await persist();
    },

    /**
     * Re-inspects one model's Python environment and reconciles the stored state with reality.
     *
     * The environment lives on disk and can decay independently of this store — a user deletes a
     * folder, a shared runtime is removed with another model, an upgrade leaves packages
     * inconsistent. This is what detects that and surfaces it as a repairable error rather than as
     * a mysterious failure at inference time.
     */
    async refreshManagedRuntimeStatus(id: string): Promise<LiatirAIModelRecord | null> {
      const model = records().find((item) => item.id === id);
      if (!model || !usesManagedPythonRuntime(model)) return model ?? null;
      setRuntimeChecking(id, true);
      try {
        const status = await getAIRuntimeStatus(model);
        if (!status) return model;
        const hasMissingPackages = status.missingPackages.length > 0;
        const missingSources = status.missingSources ?? [];
        const hasMissingSources = missingSources.length > 0;
        // Missing packages are only reported as a *problem* when the model claims to be installed,
        // is already in error, or a Python interpreter was actually found. For a model the user has
        // never installed, "packages are missing" is simply the expected state, not an error worth
        // showing them.
        const shouldSurfaceRuntimeIssue = hasMissingPackages
          && (model.status === 'installed' || model.status === 'error' || Boolean(status.pythonPath));
        // Messages are written for a non-technical user and name the fix ("Click Install"), since
        // every one of these conditions is repaired by re-running the install.
        const runtimeIssue = hasMissingSources
          ? `Runtime source files are missing: ${missingSources.join(', ')}. Click Install to repair this AI Model.`
          : status.error
          ?? (shouldSurfaceRuntimeIssue
            ? `Missing or incompatible runtime packages: ${status.missingPackages.join(', ')}`
            : undefined);
        await this.setModelState(id, {
          status: status.error || hasMissingSources || shouldSurfaceRuntimeIssue
            ? 'error'
            : status.installed
              ? 'installed'
              : 'available',
          runtimePath: status.runtimeDir,
          localPath: status.runtimeDir,
          cachePath: status.runtimeDir && model.install?.modelCacheSubdir
            ? `${status.runtimeDir}/${model.install.modelCacheSubdir}`
            : undefined,
          installedSizeBytes: status.sizeBytes ?? undefined,
          runtimeSizeBytes: status.sizeBytes ?? undefined,
          runtimeLock: status.lock ?? undefined,
          error: runtimeIssue,
        });
        return this.byId(id);
      } catch (error) {
        await this.setModelState(id, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
        return this.byId(id);
      } finally {
        setRuntimeChecking(id, false);
      }
    },

    async refreshManagedRuntimeStatuses(options: { force?: boolean } = {}): Promise<void> {
      if (!options.force && runtimeStatusesChecked) return;
      if (runtimeStatusRefreshPromise) return runtimeStatusRefreshPromise;

      const managedRuntimeModels = records().filter(usesManagedPythonRuntime);
      for (const model of managedRuntimeModels) {
        setRuntimeChecking(model.id, true);
      }
      runtimeStatusRefreshing = true;
      runtimeStatusRefreshPromise = (async () => {
        for (const model of managedRuntimeModels) {
          if (usesManagedPythonRuntime(model)) {
            await this.refreshManagedRuntimeStatus(model.id);
          }
        }
        runtimeStatusesChecked = true;
      })().finally(() => {
        runtimeStatusRefreshing = false;
        runtimeStatusRefreshPromise = null;
      });
      return runtimeStatusRefreshPromise;
    },

    async ensureManagedRuntimeStatuses(): Promise<void> {
      return this.refreshManagedRuntimeStatuses();
    },

    toggleInstallLog(id: string) {
      const current = installing[id];
      if (current) {
        installing = {
          ...installing,
          [id]: {
            ...current,
            showLog: !current.showLog,
          },
        };
        return;
      }
      const saved = installLogs[id];
      if (!saved) return;
      installLogs = {
        ...installLogs,
        [id]: {
          ...saved,
          showLog: !saved.showLog,
        },
      };
    },

    /**
     * Installs a model. Dispatches on the three install methods:
     *
     *   - `runtime-box`      download a pre-built, signed Python environment (the backend verifies
     *                        every signature and hash — see `runtime_boxes.rs`);
     *   - `managed-runtime`  build the environment locally with pip/uv, then preload the weights;
     *   - `managed-download` just fetch the declared files.
     *
     * Re-entrant by design: a second call for the same model returns the in-flight promise instead
     * of starting a second install, so a double-click cannot corrupt the install directory.
     */
    async installManagedModel(
      id: string,
      onProgress?: (progress: AIModelInstallProgress) => void
    ): Promise<LiatirAIModelRecord> {
      // Single-flight per model — see the note above.
      const existingInstall = installPromises.get(id);
      if (existingInstall) return existingInstall;

      const api = liatir();
      if (!api) throw new Error('Liatir API not available');
      const metadata = VISIBLE_LOCAL_AI_MODEL_REGISTRY.find((model) => model.id === id);
      if (!metadata) throw new Error(`Unknown AI Model: ${id}`);
      // Check the machine can actually run this model *before* downloading gigabytes for it.
      if (metadata.install?.hostRequirements) {
        const hardware = await this.ensureHardwareInfo();
        const blocked = modelInstallBlock(metadata, hardware);
        if (blocked) throw new Error(blocked.reason);
      }

      const installPromise = (async () => {
        startInstall(id, {
          phase: usesManagedPythonRuntime(metadata) ? 'preparing-runtime' : 'downloading-files',
          fileIndex: 0,
          fileCount: metadata.install?.files?.length ?? 1,
          bytesDownloaded: 0,
          bytesTotal: null,
          message: metadata.install?.method === 'runtime-box'
            ? 'Downloading Runtime Box'
            : metadata.install?.method === 'managed-runtime'
              ? 'Preparing runtime'
              : undefined,
          logLines: [`$ install AI Model ${id}`],
        });

        try {
          if (metadata.install?.method === 'runtime-box') {
            emitInstallProgress(id, {
              phase: 'preparing-runtime',
              fileIndex: 0,
              fileCount: 1,
              bytesDownloaded: 0,
              bytesTotal: null,
              message: 'Downloading Runtime Box',
              logLines: [`$ install signed Runtime Box ${metadata.install.runtimeBox?.boxId ?? id}`],
            }, onProgress);
            const installed = await installAIRuntimeBox(metadata, (progress) => {
              emitInstallProgress(id, {
                phase: 'downloading-files',
                fileIndex: 0,
                fileCount: 1,
                bytesDownloaded: progress.bytesDownloaded,
                bytesTotal: progress.bytesTotal,
                message: 'Downloading Runtime Box',
              }, onProgress);
            });
            const record: LiatirAIModelRecord = {
              ...metadata,
              status: 'installed',
              runtimePath: installed.runtimeDir,
              localPath: installed.runtimeDir,
              installedSizeBytes: installed.sizeBytes,
              runtimeSizeBytes: installed.sizeBytes,
            };
            record.cachePath = cachePathForModel(record) ?? undefined;
            const state: StoredAIModelState = {
              status: 'installed',
              runtimePath: installed.runtimeDir,
              localPath: installed.runtimeDir,
              cachePath: record.cachePath,
              installedSizeBytes: installed.sizeBytes,
              runtimeSizeBytes: installed.sizeBytes,
              enabled: true,
              error: undefined,
              updatedAt: Date.now(),
            };
            // Aggregate state *and* the durable marker — see the note at the top of the file.
            await this.setModelState(id, state);
            await appStorage.writeText(
              getInstallMarkerFile(id),
              JSON.stringify(state, null, 2),
              { createDirs: true },
            );
            finishInstall(id, 'done', 'AI Runtime Box installed');
            // Deliberately not awaited: the install is already complete and the model is usable.
            // This just reconciles the on-disk runtime in the background.
            void this.refreshManagedRuntimeStatus(id);
            return this.byId(id)!;
          }

          if (metadata.install?.method === 'managed-runtime') {
            emitInstallProgress(id, {
              phase: 'preparing-runtime',
              fileIndex: 0,
              fileCount: 1,
              bytesDownloaded: 0,
              bytesTotal: null,
              message: 'Preparing runtime',
              logLines: [`$ prepare AI runtime ${metadata.install.runtimeId ?? id}`],
            }, onProgress);
            const prepared = await prepareAIRuntime(metadata);
            // Surface the installer's own output in the log: when a dependency install fails, pip's
            // message is the only thing that explains why.
            const prepareLog = [prepared.stdout, prepared.stderr]
              .join('\n')
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);
            const record: LiatirAIModelRecord = {
              ...metadata,
              status: 'installed' as const,
              runtimePath: prepared.runtimeDir,
              localPath: prepared.runtimeDir,
              cachePath: undefined,
              installedSizeBytes: prepared.sizeBytes ?? undefined,
              runtimeSizeBytes: prepared.sizeBytes ?? undefined,
              runtimeLock: prepared.lock ?? undefined,
            };
            record.cachePath = cachePathForModel(record) ?? undefined;
            if ((metadata.install?.files?.length ?? 0) > 0) {
              if (!record.cachePath) throw new Error(`AI Model cache path is missing: ${metadata.name}`);
              await downloadInstallFiles(api, id, metadata.install?.files ?? [], record.cachePath, (progress) => {
                emitInstallProgress(id, progress, onProgress);
              });
            }
            emitInstallProgress(id, {
              phase: 'downloading-model',
              fileIndex: 0,
              fileCount: 1,
              bytesDownloaded: 0,
              bytesTotal: null,
              message: 'Downloading model',
              logLines: [
                `Runtime prepared with ${prepared.installer}`,
                ...prepareLog,
                '$ preload managed model assets',
              ],
            }, onProgress);
            await preloadManagedAIModel(record, (lines) => {
              if (lines.length === 0) return;
              emitInstallProgress(id, {
                phase: 'downloading-model',
                fileIndex: 0,
                fileCount: 1,
                bytesDownloaded: 0,
                bytesTotal: null,
                message: 'Downloading model',
                logLines: lines,
              }, onProgress);
            });
            await this.setModelState(id, {
              status: 'installed',
              runtimePath: prepared.runtimeDir,
              localPath: prepared.runtimeDir,
              cachePath: record.cachePath,
              installedSizeBytes: prepared.sizeBytes ?? undefined,
              runtimeSizeBytes: prepared.sizeBytes ?? undefined,
              runtimeLock: prepared.lock ?? undefined,
              enabled: true,
              error: undefined,
            });
            await appStorage.writeText(getInstallMarkerFile(id), JSON.stringify({
              status: 'installed',
              runtimePath: prepared.runtimeDir,
              localPath: prepared.runtimeDir,
              cachePath: record.cachePath,
              installedSizeBytes: prepared.sizeBytes ?? undefined,
              runtimeSizeBytes: prepared.sizeBytes ?? undefined,
              runtimeLock: prepared.lock ?? undefined,
              enabled: true,
              updatedAt: Date.now(),
            }, null, 2), { createDirs: true });
            finishInstall(id, 'done', 'AI Model installed');
            void this.refreshManagedRuntimeStatus(id);
            return this.byId(id)!;
          }

          const files = metadata.install?.files ?? [];
          if (metadata.install?.method !== 'managed-download' || files.length === 0) {
            throw new Error(`AI Model is not installable: ${metadata.name}`);
          }

          const dataPath = await api.desktop.fs.data.path();
          const modelDir = `${dataPath}/ai-models/managed/${id}`;
          await downloadInstallFiles(api, id, files, modelDir, (progress) => {
            emitInstallProgress(id, progress, onProgress);
          });
          const installedSizeBytes = files.reduce((total, file) => total + (file.sizeBytes ?? 0), 0) || undefined;

          await this.setModelState(id, {
            status: 'installed',
            localPath: modelDir,
            installedSizeBytes,
            enabled: true,
            error: undefined,
          });
          await appStorage.writeText(getInstallMarkerFile(id), JSON.stringify({
            status: 'installed',
            localPath: modelDir,
            installedSizeBytes,
            enabled: true,
            updatedAt: Date.now(),
          }, null, 2), { createDirs: true });
          finishInstall(id, 'done', 'AI Model installed');
          return this.byId(id)!;
        } catch (error) {
          // Record the failure in the log before rethrowing, so the user can read *why* it failed
          // rather than just seeing the install disappear.
          const message = error instanceof Error ? error.message : String(error);
          updateInstallProgress(id, {
            fileIndex: 0,
            fileCount: 1,
            bytesDownloaded: 0,
            bytesTotal: null,
            logLines: [`ERROR: ${message}`],
          });
          finishInstall(id, 'error');
          throw error;
        } finally {
          // Release the single-flight slot either way, so a failed install can be retried.
          installPromises.delete(id);
        }
      })();

      installPromises.set(id, installPromise);
      return installPromise;
    },

    /**
     * Uninstalls a model and reclaims its disk space.
     *
     * The subtlety is shared runtimes: several models can be backed by the *same* Python
     * environment (same `runtimeId`). Removing it because one of them was deleted would silently
     * break the others, so the runtime is only removed once no other installed model still needs
     * it. The model's own state is always dropped regardless.
     */
    async removeManagedModel(id: string) {
      const api = liatir();
      if (!api) return;
      const model = records().find((item) => item.id === id);
      if (!model || !['managed-download', 'managed-runtime', 'runtime-box'].includes(model.source)) return;
      if (model.localPath && model.source === 'managed-download') {
        await api.invoke('lia_managed_remove', { path: model.localPath, recursive: true }).catch(() => {});
      }
      if (model.source === 'managed-runtime' || model.source === 'runtime-box') {
        const runtimeId = runtimeIdForModel(model);
        // Is any *other* installed model still using this same runtime?
        const sharedRuntimeStillInstalled = runtimeId
          ? records().some((item) =>
              item.id !== id
              && item.status === 'installed'
              && (item.source === 'managed-runtime' || item.source === 'runtime-box')
              && runtimeIdForModel(item) === runtimeId
            )
          : false;
        if (!sharedRuntimeStillInstalled && runtimeId) {
          if (model.source === 'runtime-box' && model.install?.runtimeBox) {
            await api.invoke('lia_ai_runtime_box_remove', {
              runtimeId,
              boxId: model.install.runtimeBox.boxId,
            }).catch(() => {});
          } else {
            await removeAIRuntime(model).catch(() => {});
          }
        }
      }
      const { [id]: _removed, ...restStates } = modelStates;
      modelStates = restStates;
      // The marker must go too: leaving it behind would make the next startup resurrect this model
      // as "installed" (see `init`), even though its files are gone.
      await appStorage.remove(getInstallMarkerFile(id)).catch(() => {});
      await persist();
    },

    /**
     * Drops all in-memory state so the next `init()` re-reads from disk. Used when the app switches
     * to a different storage scope; it deletes nothing on disk.
     */
    reset() {
      initialized = false;
      modelStates = {};
      runtimeChecks = {};
      runtimeStatusesChecked = false;
      runtimeStatusRefreshing = false;
      runtimeStatusRefreshPromise = null;
      hardwareInfo = null;
      hardwareInfoChecked = false;
      hardwareInfoLoading = false;
      hardwareInfoPromise = null;
      installing = {};
      installLogs = {};
      installPromises.clear();
    },
  };
}

export const aiModelsStore = createAIModelsStore();
