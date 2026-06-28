import { liatir } from '$lib/api';
import { LOCAL_AI_MODEL_REGISTRY, MOCK_AI_MODEL_ID } from '$lib/ai/model-registry';
import { appStorage } from './app-storage';
import { getDataPrefix } from './workspace.svelte';
import type { LiatirAIModelRecord, LiatirAIModelStatus } from '@liatir/core';

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
        model.enabled !== false && (model.status === 'installed' || model.status === 'available')
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
      if (!LOCAL_AI_MODEL_REGISTRY.some((model) => model.id === id)) return;
      defaultModelId = id;
      await persist();
    },

    async setModelState(id: string, patch: StoredAIModelState) {
      if (!LOCAL_AI_MODEL_REGISTRY.some((model) => model.id === id)) return;
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

    reset() {
      initialized = false;
      defaultModelId = MOCK_AI_MODEL_ID;
      modelStates = {};
    },
  };
}

export const aiModelsStore = createAIModelsStore();
