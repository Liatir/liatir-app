import { liatir } from '$lib/api';
import { LOCAL_AI_MODEL_REGISTRY, MOCK_AI_MODEL_ID } from '$lib/ai/model-registry';
import { appStorage } from './app-storage';
import { getDataPrefix } from './workspace.svelte';
import type {
  LiatirAIModelRecord,
  LiatirAIModelStatus,
} from '@liatir/core';

interface StoredAIModelState {
  status?: LiatirAIModelStatus;
  localPath?: string;
  enabled?: boolean;
  updatedAt?: number;
  error?: string;
}

interface AIModelsWorkspaceState {
  defaultModelId: string | null;
  modelStates: Record<string, StoredAIModelState>;
}

function getFile() { return `${getDataPrefix()}ai-models.json`; }

function defaultStateFor(modelId: string): StoredAIModelState {
  return {
    status: modelId === MOCK_AI_MODEL_ID ? 'installed' : 'available',
    enabled: true,
  };
}

function createAIModelsStore() {
  let initialized = false;
  let defaultModelId = $state<string | null>(MOCK_AI_MODEL_ID);
  let modelStates = $state<Record<string, StoredAIModelState>>({});

  function allModelIds(): Set<string> {
    return new Set(LOCAL_AI_MODEL_REGISTRY.map((model) => model.id));
  }

  function records(): LiatirAIModelRecord[] {
    return LOCAL_AI_MODEL_REGISTRY.map((metadata) => {
      const state = { ...defaultStateFor(metadata.id), ...(modelStates[metadata.id] ?? {}) };
      return {
        ...metadata,
        status: state.status ?? 'available',
        localPath: state.localPath,
        enabled: state.enabled ?? true,
        updatedAt: state.updatedAt,
        error: state.error,
        isDefault: metadata.id === defaultModelId,
      };
    });
  }

  async function persist() {
    const workspace: AIModelsWorkspaceState = { defaultModelId, modelStates };
    await appStorage.writeText(getFile(), JSON.stringify(workspace, null, 2), { createDirs: true });
  }

  return {
    get initialized() { return initialized; },
    get defaultModelId() { return defaultModelId; },
    get models() { return records(); },
    get runnableModels() {
      return records().filter((model) =>
        model.enabled !== false && model.status === 'installed'
      );
    },
    get defaultModel() {
      return records().find((model) => model.id === defaultModelId) ?? records()[0] ?? null;
    },

    async init() {
      if (initialized) return;
      initialized = true;
      if (!liatir()) return;
      try {
        if (await appStorage.exists(getFile())) {
          const raw = await appStorage.readText(getFile());
          const parsed = JSON.parse(raw) as Partial<AIModelsWorkspaceState>;
          defaultModelId = parsed.defaultModelId ?? MOCK_AI_MODEL_ID;
          modelStates = parsed.modelStates ?? {};
        }
      } catch {
        defaultModelId = MOCK_AI_MODEL_ID;
        modelStates = {};
      }
    },

    byId(id: string): LiatirAIModelRecord | null {
      return records().find((model) => model.id === id) ?? null;
    },

    async setDefault(id: string) {
      if (!allModelIds().has(id)) return;
      const model = records().find((item) => item.id === id);
      if (model?.status !== 'installed') return;
      defaultModelId = id;
      await persist();
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

    async installManagedModel(
      id: string,
      onProgress?: (progress: { fileIndex: number; fileCount: number; bytesDownloaded: number; bytesTotal: number | null }) => void
    ): Promise<LiatirAIModelRecord> {
      const api = liatir();
      if (!api) throw new Error('Liatir API not available');
      const metadata = LOCAL_AI_MODEL_REGISTRY.find((model) => model.id === id);
      if (!metadata) throw new Error(`Unknown AI Model: ${id}`);
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
      await this.setDefault(id);
      return this.byId(id)!;
    },

    async removeManagedModel(id: string) {
      const api = liatir();
      if (!api) return;
      const model = records().find((item) => item.id === id);
      if (!model || model.source !== 'managed-download') return;
      if (model.localPath) {
        await api.invoke('lia_managed_remove', { path: model.localPath, recursive: true }).catch(() => {});
      }
      const { [id]: _removed, ...restStates } = modelStates;
      modelStates = restStates;
      if (defaultModelId === id) defaultModelId = MOCK_AI_MODEL_ID;
      await persist();
    },

    reset() {
      initialized = false;
      defaultModelId = MOCK_AI_MODEL_ID;
      modelStates = {};
    },
  };
}

export const aiModelsStore = createAIModelsStore();
