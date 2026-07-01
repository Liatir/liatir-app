import { liatir } from '$lib/api';
import { LOCAL_AI_MODEL_REGISTRY, MOCK_AI_MODEL_ID } from '$lib/ai/model-registry';
import { modelInstallBlock } from '$lib/ai/model-compatibility';
import { preloadManagedAIModel } from '$lib/ai/model-preload';
import { cachePathForModel, getAIHardwareInfo, getAIRuntimeStatus, prepareAIRuntime } from '$lib/ai/runtime';
import { appStorage } from './app-storage';
import { SANDBOX_WORKSPACE_ID, workspaceStore } from './workspace.svelte';
import type {
  LiatirAIModelInstallFile,
  LiatirAIModelRecord,
  LiatirAIModelStatus,
} from '@liatir/core';

const AI_MODELS_FILE = 'ai-models.json';
const AI_MODEL_INSTALL_MARKER_DIR = 'ai-model-installs';
const LEGACY_AI_MODELS_WORKSPACE_MIGRATION_FILE = 'ai-models-workspace-migration.json';
const WORKSPACES_FILE = 'workspaces.json';

interface StoredAIModelState {
  status?: LiatirAIModelStatus;
  localPath?: string;
  runtimePath?: string;
  cachePath?: string;
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

function defaultStateFor(modelId: string): StoredAIModelState {
  return {
    status: modelId === MOCK_AI_MODEL_ID ? 'installed' : 'available',
    enabled: true,
  };
}

function createAIModelsStore() {
  let initialized = false;
  let modelStates = $state<Record<string, StoredAIModelState>>({});

  function allModelIds(): Set<string> {
    return new Set(LOCAL_AI_MODEL_REGISTRY.map((model) => model.id));
  }

  function records(): LiatirAIModelRecord[] {
    return LOCAL_AI_MODEL_REGISTRY.filter((metadata) =>
      metadata.id !== MOCK_AI_MODEL_ID || workspaceStore.isSandboxMode
    ).map((metadata) => {
      const state = { ...defaultStateFor(metadata.id), ...(modelStates[metadata.id] ?? {}) };
      return {
        ...metadata,
        status: state.status ?? 'available',
        localPath: state.localPath,
        runtimePath: state.runtimePath,
        cachePath: state.cachePath,
        enabled: state.enabled ?? true,
        updatedAt: state.updatedAt,
        error: state.error,
      };
    });
  }

  async function persist() {
    const state: AIModelsState = { modelStates };
    await appStorage.writeText(getFile(), JSON.stringify(state, null, 2), { createDirs: true });
  }

  function safeInstallRelativePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error(`Unsafe AI Model install file path: ${relativePath}`);
    }
    return normalized;
  }

  async function existingFileMatches(
    api: ReturnType<typeof liatir>,
    path: string,
    expectedSize?: number
  ): Promise<boolean> {
    if (!api) return false;
    try {
      const size = (await api.invoke('lia_file_size', { path })) as number;
      return expectedSize == null ? size > 0 : size === expectedSize;
    } catch {
      return false;
    }
  }

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
      if (await existingFileMatches(api, destPath, file.sizeBytes)) {
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

      for (const metadata of LOCAL_AI_MODEL_REGISTRY) {
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
    get runnableModels() {
      return records().filter((model) =>
        model.enabled !== false && model.status === 'installed'
      );
    },
    async init() {
      const file = getFile();
      if (initialized) return;
      initialized = true;
      modelStates = {};
      if (!liatir()) return;
      try {
        modelStates = await readStoredStateFile(file);
      } catch {
        modelStates = {};
      }

      for (const metadata of LOCAL_AI_MODEL_REGISTRY) {
        if (metadata.install?.method !== 'managed-runtime' && metadata.install?.method !== 'managed-download') continue;
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
              enabled: marker.enabled ?? modelStates[metadata.id]?.enabled ?? true,
            },
          };
        } catch { /* marker recovery is best-effort */ }
      }

      await migrateLegacyWorkspaceInstalls();
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

    async refreshManagedRuntimeStatus(id: string): Promise<LiatirAIModelRecord | null> {
      const model = records().find((item) => item.id === id);
      if (!model || model.install?.method !== 'managed-runtime') return model ?? null;
      try {
        const status = await getAIRuntimeStatus(model);
        if (!status) return model;
        const runtimeIssue = status.error
          ?? (status.installed && status.missingPackages.length > 0
            ? `Missing or incompatible runtime packages: ${status.missingPackages.join(', ')}`
            : undefined);
        await this.setModelState(id, {
          status: status.error ? 'error' : status.installed ? 'installed' : 'available',
          runtimePath: status.runtimeDir,
          localPath: status.runtimeDir,
          cachePath: status.runtimeDir && model.install?.modelCacheSubdir
            ? `${status.runtimeDir}/${model.install.modelCacheSubdir}`
            : undefined,
          error: runtimeIssue,
        });
        return this.byId(id);
      } catch (error) {
        await this.setModelState(id, {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
        return this.byId(id);
      }
    },

    async refreshManagedRuntimeStatuses(): Promise<void> {
      for (const model of records()) {
        if (model.install?.method === 'managed-runtime') {
          await this.refreshManagedRuntimeStatus(model.id);
        }
      }
    },

    async installManagedModel(
      id: string,
      onProgress?: (progress: AIModelInstallProgress) => void
    ): Promise<LiatirAIModelRecord> {
      const api = liatir();
      if (!api) throw new Error('Liatir API not available');
      const metadata = LOCAL_AI_MODEL_REGISTRY.find((model) => model.id === id);
      if (!metadata) throw new Error(`Unknown AI Model: ${id}`);
      if (metadata.install?.hostRequirements) {
        const hardware = await getAIHardwareInfo();
        const blocked = modelInstallBlock(metadata, hardware);
        if (blocked) throw new Error(blocked.reason);
      }

      if (metadata.install?.method === 'managed-runtime') {
        onProgress?.({
          phase: 'preparing-runtime',
          fileIndex: 0,
          fileCount: 1,
          bytesDownloaded: 0,
          bytesTotal: null,
          message: 'Preparing runtime',
          logLines: [`$ prepare AI runtime ${metadata.install.runtimeId ?? id}`],
        });
        const prepared = await prepareAIRuntime(metadata);
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
        };
        record.cachePath = cachePathForModel(record) ?? undefined;
        if ((metadata.install?.files?.length ?? 0) > 0) {
          if (!record.cachePath) throw new Error(`AI Model cache path is missing: ${metadata.name}`);
          await downloadInstallFiles(api, id, metadata.install?.files ?? [], record.cachePath, onProgress);
        }
        onProgress?.({
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
        });
        await preloadManagedAIModel(record, (lines) => {
          if (lines.length === 0) return;
          onProgress?.({
            phase: 'downloading-model',
            fileIndex: 0,
            fileCount: 1,
            bytesDownloaded: 0,
            bytesTotal: null,
            message: 'Downloading model',
            logLines: lines,
          });
        });
        await this.setModelState(id, {
          status: 'installed',
          runtimePath: prepared.runtimeDir,
          localPath: prepared.runtimeDir,
          cachePath: record.cachePath,
          enabled: true,
          error: undefined,
        });
        await appStorage.writeText(getInstallMarkerFile(id), JSON.stringify({
          status: 'installed',
          runtimePath: prepared.runtimeDir,
          localPath: prepared.runtimeDir,
          cachePath: record.cachePath,
          enabled: true,
          updatedAt: Date.now(),
        }, null, 2), { createDirs: true });
        return this.byId(id)!;
      }

      const files = metadata.install?.files ?? [];
      if (metadata.install?.method !== 'managed-download' || files.length === 0) {
        throw new Error(`AI Model is not installable: ${metadata.name}`);
      }

      const dataPath = await api.desktop.fs.data.path();
      const modelDir = `${dataPath}/ai-models/managed/${id}`;
      await downloadInstallFiles(api, id, files, modelDir, onProgress);

      await this.setModelState(id, {
        status: 'installed',
        localPath: modelDir,
        enabled: true,
        error: undefined,
      });
      await appStorage.writeText(getInstallMarkerFile(id), JSON.stringify({
        status: 'installed',
        localPath: modelDir,
        enabled: true,
        updatedAt: Date.now(),
      }, null, 2), { createDirs: true });
      return this.byId(id)!;
    },

    async removeManagedModel(id: string) {
      const api = liatir();
      if (!api) return;
      const model = records().find((item) => item.id === id);
      if (!model || (model.source !== 'managed-download' && model.source !== 'managed-runtime')) return;
      if (model.localPath && model.source === 'managed-download') {
        await api.invoke('lia_managed_remove', { path: model.localPath, recursive: true }).catch(() => {});
      }
      const { [id]: _removed, ...restStates } = modelStates;
      modelStates = restStates;
      await appStorage.remove(getInstallMarkerFile(id)).catch(() => {});
      await persist();
    },

    reset() {
      initialized = false;
      modelStates = {};
    },
  };
}

export const aiModelsStore = createAIModelsStore();
