// Product and release-candidate metadata both live in Core, the shared source of truth.
import {
  SCGPT_WHOLE_HUMAN_MODEL_ID,
  GENEFORMER_V1_10M_MODEL_ID,
  UCE_4LAYER_MODEL_ID,
  RUNTIME_BOX_AI_MODEL_REGISTRY as PRODUCT_RUNTIME_BOX_AI_MODEL_REGISTRY,
  type LiatirAIModelMetadata,
} from '@liatir/core';
import { runtimeBoxReleaseCandidate } from '$lib/runtime-box-release-candidate';

export { SCGPT_WHOLE_HUMAN_MODEL_ID, GENEFORMER_V1_10M_MODEL_ID, UCE_4LAYER_MODEL_ID };

export const RUNTIME_BOX_AI_MODEL_REGISTRY: LiatirAIModelMetadata[] = runtimeBoxReleaseCandidate?.kind === 'ai-model'
  ? [...PRODUCT_RUNTIME_BOX_AI_MODEL_REGISTRY, runtimeBoxReleaseCandidate.metadata]
  : PRODUCT_RUNTIME_BOX_AI_MODEL_REGISTRY;

export function getRuntimeBoxAIModelMetadata(id: string): LiatirAIModelMetadata | undefined {
  return RUNTIME_BOX_AI_MODEL_REGISTRY.find((model) => model.id === id);
}
