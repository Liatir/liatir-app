// Product and release-candidate metadata both live in Core, the shared source of truth.
import {
  SCGPT_WHOLE_HUMAN_MODEL_ID,
  GENEFORMER_V1_10M_MODEL_ID,
  UCE_4LAYER_MODEL_ID,
  MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID,
  RUNTIME_BOX_AI_MODEL_REGISTRY as PRODUCT_RUNTIME_BOX_AI_MODEL_REGISTRY,
  type LiatirAIModelMetadata,
} from '@liatir/core';
import { runtimeBoxReleaseCandidate } from '$lib/runtime-box-release-candidate';

export {
  SCGPT_WHOLE_HUMAN_MODEL_ID,
  GENEFORMER_V1_10M_MODEL_ID,
  UCE_4LAYER_MODEL_ID,
  MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID,
};

const releaseCandidate = runtimeBoxReleaseCandidate?.kind === 'ai-model'
  ? runtimeBoxReleaseCandidate.metadata
  : null;

export const RUNTIME_BOX_AI_MODEL_REGISTRY: LiatirAIModelMetadata[] = releaseCandidate
  && !PRODUCT_RUNTIME_BOX_AI_MODEL_REGISTRY.some((model) => model.id === releaseCandidate.id)
  ? [...PRODUCT_RUNTIME_BOX_AI_MODEL_REGISTRY, releaseCandidate]
  : PRODUCT_RUNTIME_BOX_AI_MODEL_REGISTRY;

export function getRuntimeBoxAIModelMetadata(id: string): LiatirAIModelMetadata | undefined {
  return RUNTIME_BOX_AI_MODEL_REGISTRY.find((model) => model.id === id);
}
