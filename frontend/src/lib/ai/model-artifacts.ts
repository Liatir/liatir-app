import type { LiatirAIModelMetadata, LiatirAIModelRecord } from '@liatir/core';
import {
	BOLTZ2_MODEL_ID,
	CELLTYPIST_MODEL_ID,
	CHAI1_MODEL_ID,
	ESM2_8M_ID,
	MOCK_AI_MODEL_ID,
	NUCLEOTIDE_TRANSFORMER_500M_ID,
	NUCLEOTIDE_TRANSFORMER_50M_ID
} from './model-registry';

export type AIModelRuntimeFamily =
	| 'development-fixture'
	| 'single-cell-celltypist'
	| 'sequence-transformers'
	| 'protein-structure-boltz'
	| 'protein-structure-chai';

export type AIModelPreloadKind = 'none' | 'celltypist' | 'huggingface-transformers';

export interface AIModelArtifactSpec {
	modelId: string;
	runtimeFamily: AIModelRuntimeFamily;
	preloadKind: AIModelPreloadKind;
	upstreamModelId?: string;
	transformersLoader?: 'auto-model' | 'masked-lm';
	defaultAsset?: string;
}

export const AI_MODEL_ARTIFACT_SPECS: AIModelArtifactSpec[] = [
	{
		modelId: MOCK_AI_MODEL_ID,
		runtimeFamily: 'development-fixture',
		preloadKind: 'none'
	},
	{
		modelId: CELLTYPIST_MODEL_ID,
		runtimeFamily: 'single-cell-celltypist',
		preloadKind: 'celltypist',
		defaultAsset: 'Immune_All_Low.pkl'
	},
	{
		modelId: NUCLEOTIDE_TRANSFORMER_50M_ID,
		runtimeFamily: 'sequence-transformers',
		preloadKind: 'huggingface-transformers',
		upstreamModelId: 'InstaDeepAI/nucleotide-transformer-v2-50m-multi-species',
		transformersLoader: 'masked-lm'
	},
	{
		modelId: NUCLEOTIDE_TRANSFORMER_500M_ID,
		runtimeFamily: 'sequence-transformers',
		preloadKind: 'huggingface-transformers',
		upstreamModelId: 'InstaDeepAI/nucleotide-transformer-v2-500m-multi-species',
		transformersLoader: 'masked-lm'
	},
	{
		modelId: ESM2_8M_ID,
		runtimeFamily: 'sequence-transformers',
		preloadKind: 'huggingface-transformers',
		upstreamModelId: 'facebook/esm2_t6_8M_UR50D',
		transformersLoader: 'auto-model'
	},
	{
		modelId: BOLTZ2_MODEL_ID,
		runtimeFamily: 'protein-structure-boltz',
		preloadKind: 'none'
	},
	{
		modelId: CHAI1_MODEL_ID,
		runtimeFamily: 'protein-structure-chai',
		preloadKind: 'none'
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

export function huggingFaceArtifactForModel(
	model: Pick<LiatirAIModelRecord, 'id' | 'install' | 'name'>
): { upstreamModelId: string; revision: string | null; transformersLoader: 'auto-model' | 'masked-lm' } | null {
	const spec = artifactSpecForModel(model);
	if (!spec?.upstreamModelId || spec.preloadKind !== 'huggingface-transformers') return null;
	return {
		upstreamModelId: spec.upstreamModelId,
		revision: model.install?.revision ?? null,
		transformersLoader: spec.transformersLoader ?? 'auto-model'
	};
}

export function requireHuggingFaceArtifactForModel(
	model: Pick<LiatirAIModelRecord, 'id' | 'install' | 'name'>
): { upstreamModelId: string; revision: string | null; transformersLoader: 'auto-model' | 'masked-lm' } {
	const artifact = huggingFaceArtifactForModel(model);
	if (!artifact) throw new Error(`${model.name} is not backed by a Hugging Face Transformers artifact.`);
	return artifact;
}
