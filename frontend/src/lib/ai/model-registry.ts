import type { LiatirAIModelMetadata, LiatirFieldOption } from '@liatir/core';

export const MOCK_AI_MODEL_ID = 'liatir-mock-local';

export const LOCAL_AI_MODEL_REGISTRY: LiatirAIModelMetadata[] = [
  {
    id: MOCK_AI_MODEL_ID,
    name: 'Liatir Mock Local Model',
    description: 'Deterministic local model fixture for validating AI Tool wiring without loading model weights.',
    version: '0.1.0',
    runtime: {
      kind: 'mock',
      name: 'Liatir Mock Runtime',
      version: '0.1.0',
    },
    source: 'builtin',
    localOnly: true,
    capabilities: ['text-generation', 'structured-extraction'],
    modalities: ['text'],
    license: {
      name: 'Internal development fixture',
    },
    hardware: {
      cpu: true,
      gpu: false,
      minRamGb: 0,
      recommendedRamGb: 0,
      notes: 'No model weights are loaded.',
    },
    install: {
      method: 'builtin',
    },
    tags: ['mock', 'local', 'development'],
  },
];

export function getLocalAIModelMetadata(id: string): LiatirAIModelMetadata | undefined {
  return LOCAL_AI_MODEL_REGISTRY.find((model) => model.id === id);
}

export function localAIModelOptions(): LiatirFieldOption[] {
  return LOCAL_AI_MODEL_REGISTRY.map((model) => ({
    value: model.id,
    label: model.name,
    description: model.description,
  }));
}
