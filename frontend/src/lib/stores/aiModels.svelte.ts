import { liatir } from '$lib/api';
import { LOCAL_AI_MODEL_REGISTRY, MOCK_AI_MODEL_ID } from '$lib/ai/model-registry';
import { preloadManagedAIModel } from '$lib/ai/model-preload';
import { cachePathForModel, getAIRuntimeStatus, prepareAIRuntime } from '$lib/ai/runtime';
import { appStorage } from './app-storage';
import { SANDBOX_WORKSPACE_ID, workspaceStore } from './workspace.svelte';
import type {
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
        await this.setModelState(id, {
          runtimePath: status.runtimeDir,
          localPath: status.runtimeDir,
          cachePath: status.runtimeDir && model.install?.modelCacheSubdir
            ? `${status.runtimeDir}/${model.install.modelCacheSubdir}`
            : undefined,
          error: status.error ?? undefined,
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
      onProgress?: (progress: {
        phase?: 'preparing-runtime' | 'installing-packages' | 'downloading-model' | 'downloading-files';
        fileIndex: number;
        fileCount: number;
        bytesDownloaded: number;
        bytesTotal: number | null;
        message?: string;
      }) => void
    ): Promise<LiatirAIModelRecord> {
      const api = liatir();
      if (!api) throw new Error('Liatir API not available');
      const metadata = LOCAL_AI_MODEL_REGISTRY.find((model) => model.id === id);
      if (!metadata) throw new Error(`Unknown AI Model: ${id}`);

      if (metadata.install?.method === 'managed-runtime') {
        onProgress?.({
          phase: 'preparing-runtime',
          fileIndex: 0,
          fileCount: 1,
          bytesDownloaded: 0,
          bytesTotal: null,
          message: 'Preparing runtime',
        });
        const prepared = await prepareAIRuntime(metadata);
        const record: LiatirAIModelRecord = {
          ...metadata,
          status: 'installed' as const,
          runtimePath: prepared.runtimeDir,
          localPath: prepared.runtimeDir,
          cachePath: undefined,
        };
        record.cachePath = cachePathForModel(record) ?? undefined;
        onProgress?.({
          phase: 'downloading-model',
          fileIndex: 0,
          fileCount: 1,
          bytesDownloaded: 0,
          bytesTotal: null,
          message: 'Downloading model',
        });
        await preloadManagedAIModel(record);
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

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const downloadId = `${id}-${index}-${crypto.randomUUID()}`;
        const destPath = `${modelDir}/${file.relativePath}`;
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
