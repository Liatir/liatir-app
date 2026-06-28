import type { LiatirAIModelMetadata } from '@liatir/core';

export const MOCK_AI_MODEL_ID = 'liatir-mock-local';
export const SMOLLM2_135M_INSTRUCT_ID = 'hf-smollm2-135m-instruct';

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
  {
    id: SMOLLM2_135M_INSTRUCT_ID,
    name: 'SmolLM2 135M Instruct',
    description: 'Small on-device instruction model for lightweight local text generation and pipeline summaries.',
    version: 'main',
    runtime: {
      kind: 'transformers-js',
      name: 'Transformers.js',
    },
    source: 'managed-download',
    localOnly: true,
    capabilities: ['text-generation', 'summarization', 'structured-extraction'],
    modalities: ['text'],
    parameters: 135_000_000,
    license: {
      name: 'Apache License 2.0',
      spdxId: 'Apache-2.0',
      url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct',
      verifiedAt: '2026-06-28',
    },
    hardware: {
      cpu: true,
      gpu: false,
      minRamGb: 2,
      recommendedRamGb: 4,
      notes: 'Small on-device model. Final runtime memory should be re-measured inside Liatir before broad release.',
    },
    install: {
      method: 'managed-download',
      files: [
        {
          url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/config.json',
          relativePath: 'config.json',
        },
        {
          url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/tokenizer.json',
          relativePath: 'tokenizer.json',
        },
        {
          url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/tokenizer_config.json',
          relativePath: 'tokenizer_config.json',
        },
        {
          url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/model.safetensors',
          relativePath: 'model.safetensors',
        },
      ],
    },
    tags: ['built-in', 'managed', 'small', 'on-device'],
  },
];

export function getLocalAIModelMetadata(id: string): LiatirAIModelMetadata | undefined {
  return LOCAL_AI_MODEL_REGISTRY.find((model) => model.id === id);
}
