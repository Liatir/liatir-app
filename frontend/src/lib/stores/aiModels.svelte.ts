import { liatir } from '$lib/api';
import { LOCAL_AI_MODEL_REGISTRY, MOCK_AI_MODEL_ID } from '$lib/ai/model-registry';
import { appStorage } from './app-storage';
import { getDataPrefix } from './workspace.svelte';
import type {
  LiatirAICapability,
  LiatirAIModelModality,
  LiatirAIModelRecord,
  LiatirAIModelRuntimeKind,
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
  customModels: LiatirAIModelRecord[];
}

export interface RegisterLocalAIModelInput {
  name: string;
  path: string;
  runtimeKind: Exclude<LiatirAIModelRuntimeKind, 'mock'>;
  description?: string;
  capabilities?: LiatirAICapability[];
  modalities?: LiatirAIModelModality[];
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
  let customModels = $state<LiatirAIModelRecord[]>([]);

  function allModelIds(): Set<string> {
    return new Set([...LOCAL_AI_MODEL_REGISTRY.map((model) => model.id), ...customModels.map((model) => model.id)]);
  }

  function isBuiltinModel(id: string): boolean {
    return LOCAL_AI_MODEL_REGISTRY.some((model) => model.id === id);
  }

  function records(): LiatirAIModelRecord[] {
    const builtinRecords = LOCAL_AI_MODEL_REGISTRY.map((metadata) => {
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
    const localRecords = customModels.map((model) => {
      const state = modelStates[model.id] ?? {};
      return {
        ...model,
        status: state.status ?? model.status,
        localPath: state.localPath ?? model.localPath,
        enabled: state.enabled ?? model.enabled ?? true,
        updatedAt: state.updatedAt ?? model.updatedAt,
        error: state.error ?? model.error,
        isDefault: model.id === defaultModelId,
      };
    });
    return [...builtinRecords, ...localRecords];
  }

  async function persist() {
    const workspace: AIModelsWorkspaceState = { defaultModelId, modelStates, customModels };
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
          customModels = parsed.customModels ?? [];
        }
      } catch {
        defaultModelId = MOCK_AI_MODEL_ID;
        modelStates = {};
        customModels = [];
      }
    },

    byId(id: string): LiatirAIModelRecord | null {
      return records().find((model) => model.id === id) ?? null;
    },

    async setDefault(id: string) {
      if (!allModelIds().has(id)) return;
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

    async registerLocalModel(input: RegisterLocalAIModelInput): Promise<LiatirAIModelRecord> {
      const now = Date.now();
      const id = `local-${crypto.randomUUID()}`;
      const model: LiatirAIModelRecord = {
        id,
        name: input.name.trim(),
        description: input.description?.trim() || 'User-registered local model file.',
        runtime: {
          kind: input.runtimeKind,
          name: input.runtimeKind === 'llama-cpp'
            ? 'llama.cpp'
            : input.runtimeKind === 'onnx'
              ? 'ONNX Runtime'
              : 'Custom local runtime',
        },
        source: 'local-file',
        localOnly: true,
        capabilities: input.capabilities?.length ? input.capabilities : ['text-generation'],
        modalities: input.modalities?.length ? input.modalities : ['text'],
        install: {
          method: 'local-file',
          path: input.path,
        },
        license: {
          name: 'Unverified local model license',
        },
        hardware: {
          notes: 'Hardware requirements must be verified from the model provider before production use.',
        },
        tags: ['local', 'user-registered'],
        status: 'installed',
        localPath: input.path,
        enabled: true,
        addedAt: now,
        updatedAt: now,
      };
      customModels = [model, ...customModels];
      defaultModelId = id;
      await persist();
      return model;
    },

    async removeLocalModel(id: string) {
      if (isBuiltinModel(id)) return;
      customModels = customModels.filter((model) => model.id !== id);
      const { [id]: _removed, ...restStates } = modelStates;
      modelStates = restStates;
      if (defaultModelId === id) defaultModelId = MOCK_AI_MODEL_ID;
      await persist();
    },

    reset() {
      initialized = false;
      defaultModelId = MOCK_AI_MODEL_ID;
      modelStates = {};
      customModels = [];
    },
  };
}

export const aiModelsStore = createAIModelsStore();
