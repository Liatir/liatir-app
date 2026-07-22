/**
 * Runtime-owned model asset paths for the signed Runtime Box catalog.
 *
 * Installation and preloading do not happen here: each Runtime Box already
 * contains its complete, verified model payload. These specs only tell the
 * shared single-cell runner where the model-specific entry asset lives.
 */
import type { LiatirAIModelMetadata, LiatirAIModelRecord } from '@liatir/core';
import {
	GENEFORMER_V1_10M_MODEL_ID,
	SCGPT_WHOLE_HUMAN_MODEL_ID,
	UCE_4LAYER_MODEL_ID
} from './model-registry';

export type AIModelRuntimeFamily =
	| 'single-cell-foundation-scgpt'
	| 'single-cell-foundation-geneformer'
	| 'single-cell-foundation-uce';

export interface AIModelArtifactSpec {
	modelId: string;
	runtimeFamily: AIModelRuntimeFamily;
	modelFile: string;
}

export const AI_MODEL_ARTIFACT_SPECS: AIModelArtifactSpec[] = [
	{
		modelId: SCGPT_WHOLE_HUMAN_MODEL_ID,
		runtimeFamily: 'single-cell-foundation-scgpt',
		modelFile: 'best_model.pt'
	},
	{
		modelId: GENEFORMER_V1_10M_MODEL_ID,
		runtimeFamily: 'single-cell-foundation-geneformer',
		modelFile: 'model/model.safetensors'
	},
	{
		modelId: UCE_4LAYER_MODEL_ID,
		runtimeFamily: 'single-cell-foundation-uce',
		modelFile: 'model_files/4layer_model.torch'
	}
];

const ARTIFACTS_BY_MODEL_ID = new Map(
	AI_MODEL_ARTIFACT_SPECS.map((spec) => [spec.modelId, spec])
);

export function artifactSpecForModelId(modelId: string): AIModelArtifactSpec | null {
	return ARTIFACTS_BY_MODEL_ID.get(modelId) ?? null;
}

export function artifactSpecForModel(
	model: Pick<LiatirAIModelMetadata | LiatirAIModelRecord, 'id'>
): AIModelArtifactSpec | null {
	return artifactSpecForModelId(model.id);
}

export function requireArtifactSpecForModel(
	model: Pick<LiatirAIModelMetadata | LiatirAIModelRecord, 'id' | 'name'>
): AIModelArtifactSpec {
	const spec = artifactSpecForModel(model);
	if (!spec) throw new Error(`Missing AI artifact spec for ${model.name}.`);
	return spec;
}
