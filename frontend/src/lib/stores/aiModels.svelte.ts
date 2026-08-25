/**
 * Store for locally installed AI Models.
 *
 * Ownership: AI Models are a **machine-level** resource, not a per-workspace one. They are
 * multi-gigabyte assets and several workspaces routinely use the same model, so installing one
 * makes it available everywhere.
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
import { RUNTIME_BOX_AI_MODEL_REGISTRY } from '$lib/ai/model-registry';
import { modelInstallBlock } from '$lib/ai/model-compatibility';
import {
  cachePathForModel,
  cancelAIRuntimeBoxDownload,
  checkAIRuntimeBoxUpdate,
  getAIHardwareInfo,
  getAIRuntimeStatus,
  installAIRuntimeBox,
  removeAIRuntimeBox,
  rollbackAIRuntimeBox,
  runtimeIdForModel,
  type AIHardwareInfo,
} from '$lib/ai/runtime';
import { appStorage } from './app-storage';
import type {
  LiatirAIModelMetadata,
  LiatirAIModelRecord,
  LiatirAIModelStatus,
  LiatirRuntimeBoxActivationMetadata,
} from '@liatir/core';

/** Aggregate state for every model, rewritten on each change. */
const AI_MODELS_FILE = 'ai-models.json';
/** One marker file per installed model — the durable record that survives a lost aggregate file. */
const AI_MODEL_INSTALL_MARKER_DIR = 'ai-model-installs';
/** What is persisted per model. Everything else in a record comes from the static registry. */
interface StoredAIModelState {
  status?: LiatirAIModelStatus;
  localPath?: string;
  runtimePath?: string;
  cachePath?: string;
  installedSizeBytes?: number;
  runtimeSizeBytes?: number;
  cacheSizeBytes?: number;
  runtimeBoxActivation?: LiatirRuntimeBoxActivationMetadata;
  enabled?: boolean;
  updatedAt?: number;
  error?: string;
}

interface AIModelsState {
  modelStates: Record<string, StoredAIModelState>;
}

export interface AIModelInstallProgress {
  phase?: 'preparing-runtime' | 'downloading-files';
  fileIndex: number;
  fileCount: number;
  bytesDownloaded: number;
  bytesTotal: number | null;
  message?: string;
  logLines?: string[];
}

/** Live progress of an install that is currently running. */
export type AIModelInstallState = AIModelInstallProgress & {
  downloadId?: string;
  showLog: boolean;
  logLines: string[];
  startedAt: number;
};

export interface AIModelUpdateState {
  checking: boolean;
  checkedAt?: string;
  currentVersion?: string | null;
  availableVersion?: string | null;
  updateAvailable: boolean;
  error?: string;
}

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

function defaultStateFor(_modelId: string): StoredAIModelState {
  return {
    status: 'available',
    enabled: true,
  };
}

/** Keeps schema-v1 installs removable but prevents them from being dispatched or updated. */
function rejectUnsupportedRuntimeBoxState(state: StoredAIModelState): StoredAIModelState {
  const activation = state.runtimeBoxActivation as
    | { schemaVersion?: number }
    | undefined;
  if (!activation || activation.schemaVersion === 2) return state;
  return {
    ...state,
    status: 'error',
    enabled: false,
    error: 'This AI Model uses an unsupported Runtime Box format. Remove and reinstall it.',
  };
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
  /** Signed-channel update checks, keyed per model and never run automatically. */
  let updates = $state<Record<string, AIModelUpdateState>>({});
  // These three are single-flight guards, not reactive state: they exist so that N callers asking
  // for the same work get the one in-flight promise instead of each starting a duplicate job.
  let runtimeStatusRefreshPromise: Promise<void> | null = null;
  let hardwareInfoPromise: Promise<AIHardwareInfo | null> | null = null;
  const installPromises = new Map<string, Promise<LiatirAIModelRecord>>();

  function allModelIds(): Set<string> {
    return new Set(RUNTIME_BOX_AI_MODEL_REGISTRY.map((model) => model.id));
  }

  /**
   * The registry is the source of truth for *what* models exist; this store only tracks their
   * local state. A record is the two merged, so a model the user has never touched still appears
   * with sensible defaults.
   */
  function records(): LiatirAIModelRecord[] {
    return RUNTIME_BOX_AI_MODEL_REGISTRY.map((metadata) => {
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
        runtimeBoxActivation: state.runtimeBoxActivation,
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
        downloadId: current?.downloadId,
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

  function startInstall(id: string, progress: AIModelInstallProgress & { downloadId?: string }) {
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

  async function readStoredStateFile(file: string): Promise<Record<string, StoredAIModelState>> {
    if (!await appStorage.exists(file)) return {};
    const raw = await appStorage.readText(file);
    const parsed = JSON.parse(raw) as Partial<AIModelsState>;
    return parsed.modelStates ?? {};
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
    get updates() { return updates; },
    /**
     * Models the rest of the app may actually run: enabled, installed, and not currently
     * mid-check. Excluding models under inspection avoids handing a caller a runtime that is about
     * to be reported as broken.
     */
    get runnableModels() {
      return records().filter((model) =>
        model.enabled !== false && model.status === 'installed' && !runtimeChecks[model.id]
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
        modelStates = Object.fromEntries(
          Object.entries(await readStoredStateFile(file)).map(
            ([id, state]) => [id, rejectUnsupportedRuntimeBoxState(state)],
          ),
        );
      } catch {
        // A corrupted aggregate file is not fatal — the markers below can rebuild what matters.
        modelStates = {};
      }

      for (const metadata of RUNTIME_BOX_AI_MODEL_REGISTRY) {
        try {
          const markerFile = getInstallMarkerFile(metadata.id);
          if (!await appStorage.exists(markerFile)) continue;
          const raw = await appStorage.readText(markerFile);
          const marker = JSON.parse(raw) as StoredAIModelState;
          const recovered = rejectUnsupportedRuntimeBoxState({
            ...defaultStateFor(metadata.id),
            ...(modelStates[metadata.id] ?? {}),
            ...marker,
            status: 'installed',
            // `enabled` is a user preference, so keep whatever was set rather than resetting it.
            enabled: marker.enabled ?? modelStates[metadata.id]?.enabled ?? true,
          });
          modelStates = {
            ...modelStates,
            [metadata.id]: recovered,
          };
        } catch { /* marker recovery is best-effort */ }
      }
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
     * Re-inspects one model's Runtime Box and reconciles the stored state with reality.
     *
     * The environment lives on disk and can decay independently of this store — a user deletes a
     * folder, a shared runtime is removed with another model, an upgrade leaves packages
     * inconsistent. This is what detects that and surfaces it as a repairable error rather than as
     * a mysterious failure at inference time.
     */
    async refreshRuntimeBoxStatus(id: string): Promise<LiatirAIModelRecord | null> {
      const model = records().find((item) => item.id === id);
      if (!model) return null;
      setRuntimeChecking(id, true);
      try {
        const status = await getAIRuntimeStatus(model);
        if (!status) return model;
        const hasMissingPackages = status.missingPackages.length > 0;
        // Missing packages are only reported as a *problem* when the model claims to be installed,
        // is already in error, or a Python interpreter was actually found. For a model the user has
        // never installed, "packages are missing" is simply the expected state, not an error worth
        // showing them.
        const shouldSurfaceRuntimeIssue = hasMissingPackages
          && (model.status === 'installed' || model.status === 'error' || Boolean(status.pythonPath));
        // Messages are written for a non-technical user and name the fix ("Click Install"), since
        // every one of these conditions is repaired by re-running the install.
        const runtimeIssue = status.error
          ?? (shouldSurfaceRuntimeIssue
            ? `Missing or incompatible runtime packages: ${status.missingPackages.join(', ')}`
            : undefined);
        await this.setModelState(id, {
          status: status.error || shouldSurfaceRuntimeIssue
            ? 'error'
            : status.installed
              ? 'installed'
              : 'available',
          runtimePath: status.runtimeDir,
          localPath: status.runtimeDir,
          cachePath: status.runtimeDir && model.install.modelCacheSubdir
            ? `${status.runtimeDir}/${model.install.modelCacheSubdir}`
            : undefined,
          installedSizeBytes: status.sizeBytes ?? undefined,
          runtimeSizeBytes: status.sizeBytes ?? undefined,
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

    async refreshRuntimeBoxStatuses(options: { force?: boolean } = {}): Promise<void> {
      if (!options.force && runtimeStatusesChecked) return;
      if (runtimeStatusRefreshPromise) return runtimeStatusRefreshPromise;

      const runtimeBoxModels = records();
      for (const model of runtimeBoxModels) {
        setRuntimeChecking(model.id, true);
      }
      runtimeStatusRefreshing = true;
      runtimeStatusRefreshPromise = (async () => {
        for (const model of runtimeBoxModels) {
          await this.refreshRuntimeBoxStatus(model.id);
        }
        runtimeStatusesChecked = true;
      })().finally(() => {
        runtimeStatusRefreshing = false;
        runtimeStatusRefreshPromise = null;
      });
      return runtimeStatusRefreshPromise;
    },

    async ensureRuntimeBoxStatuses(): Promise<void> {
      return this.refreshRuntimeBoxStatuses();
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

    async checkRuntimeBoxUpdate(id: string): Promise<AIModelUpdateState> {
      const model = records().find((item) => item.id === id);
      if (!model) throw new Error(`Unknown AI Model: ${id}`);
      if (model.status !== 'installed') throw new Error('Install this AI Model before checking for updates.');
      updates = {
        ...updates,
        [id]: { ...(updates[id] ?? { updateAvailable: false }), checking: true, error: undefined },
      };
      try {
        const update = await checkAIRuntimeBoxUpdate(model);
        const state: AIModelUpdateState = {
          checking: false,
          checkedAt: update?.checkedAt,
          currentVersion: update?.currentVersion,
          availableVersion: update?.availableVersion,
          updateAvailable: update?.updateAvailable ?? false,
        };
        updates = { ...updates, [id]: state };
        return state;
      } catch (error) {
        const state: AIModelUpdateState = {
          checking: false,
          updateAvailable: false,
          error: error instanceof Error ? error.message : String(error),
        };
        updates = { ...updates, [id]: state };
        return state;
      }
    },

    /**
     * Installs a pre-built, signed Runtime Box. The backend verifies its signatures and hashes
     * before atomically activating it; see `runtime_boxes.rs`.
     *
     * Re-entrant by design: a second call for the same model returns the in-flight promise instead
     * of starting a second install, so a double-click cannot corrupt the install directory.
     */
    async installRuntimeBoxModel(
      id: string,
      onProgress?: (progress: AIModelInstallProgress) => void
    ): Promise<LiatirAIModelRecord> {
      // Single-flight per model — see the note above.
      const existingInstall = installPromises.get(id);
      if (existingInstall) return existingInstall;

      if (!liatir()) throw new Error('Liatir API not available');
      const metadata = RUNTIME_BOX_AI_MODEL_REGISTRY.find((model) => model.id === id);
      if (!metadata) throw new Error(`Unknown AI Model: ${id}`);
      // Check the machine can actually run this model *before* downloading gigabytes for it.
      if (metadata.install.hostRequirements) {
        const hardware = await this.ensureHardwareInfo();
        const blocked = modelInstallBlock(metadata, hardware);
        if (blocked) throw new Error(blocked.reason);
      }

      const installPromise = (async () => {
        const downloadId = `runtime-box-${metadata.id}-${crypto.randomUUID()}`;
        startInstall(id, {
          downloadId,
          phase: 'preparing-runtime',
          fileIndex: 0,
          fileCount: 1,
          bytesDownloaded: 0,
          bytesTotal: null,
          message: 'Downloading Runtime Box',
          logLines: [`$ install AI Model ${id}`],
        });

        try {
          emitInstallProgress(id, {
            phase: 'preparing-runtime',
            fileIndex: 0,
            fileCount: 1,
            bytesDownloaded: 0,
            bytesTotal: null,
            message: 'Downloading Runtime Box',
            logLines: [`$ install signed Runtime Box ${metadata.install.runtimeBox.boxId}`],
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
          }, downloadId);
          const record: LiatirAIModelRecord = {
            ...metadata,
            status: 'installed',
            runtimePath: installed.runtimeDir,
            localPath: installed.runtimeDir,
            installedSizeBytes: installed.sizeBytes,
            runtimeSizeBytes: installed.sizeBytes,
            runtimeBoxActivation: installed.activation,
          };
          record.cachePath = cachePathForModel(record) ?? undefined;
          const state: StoredAIModelState = {
            status: 'installed',
            runtimePath: installed.runtimeDir,
            localPath: installed.runtimeDir,
            cachePath: record.cachePath,
            installedSizeBytes: installed.sizeBytes,
            runtimeSizeBytes: installed.sizeBytes,
            runtimeBoxActivation: installed.activation,
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
          updates = { ...updates, [id]: { checking: false, updateAvailable: false } };
          // Deliberately not awaited: the install is already complete and the model is usable.
          // This just reconciles the on-disk runtime in the background.
          void this.refreshRuntimeBoxStatus(id);
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

    async cancelRuntimeBoxInstall(id: string): Promise<boolean> {
      const downloadId = installing[id]?.downloadId;
      if (!downloadId) return false;
      return cancelAIRuntimeBoxDownload(downloadId);
    },

    async rollbackRuntimeBoxModel(id: string): Promise<boolean> {
      const model = records().find((item) => item.id === id);
      if (!model) throw new Error(`Unknown AI Model: ${id}`);
      const result = await rollbackAIRuntimeBox(model);
      if (result.restored) {
        updates = { ...updates, [id]: { checking: false, updateAvailable: false } };
        await this.refreshRuntimeBoxStatus(id);
      }
      return result.restored;
    },

    /**
     * Uninstalls a model and reclaims its disk space.
     *
     * Runtime IDs are checked for sharing before removing the activated box so one model cannot
     * silently break another model backed by the same runtime.
     */
    async removeRuntimeBoxModel(id: string) {
      const api = liatir();
      if (!api) return;
      const model = records().find((item) => item.id === id);
      if (!model) return;
      const runtimeId = runtimeIdForModel(model);
      // Is any *other* installed model still using this same runtime?
      const sharedRuntimeStillInstalled = records().some((item) =>
        item.id !== id
        && item.status === 'installed'
        && runtimeIdForModel(item) === runtimeId
      );
      if (!sharedRuntimeStillInstalled) {
        await removeAIRuntimeBox(model);
      }
      const { [id]: _removed, ...restStates } = modelStates;
      modelStates = restStates;
      // The marker must go too: leaving it behind would make the next startup resurrect this model
      // as "installed" (see `init`), even though its files are gone.
      await appStorage.remove(getInstallMarkerFile(id)).catch(() => {});
      const { [id]: _removedUpdate, ...restUpdates } = updates;
      updates = restUpdates;
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
      updates = {};
      installPromises.clear();
    },
  };
}

export const aiModelsStore = createAIModelsStore();
