import type { LiatirAIModelMetadata, LiatirAIModelRecord } from '@liatir/core';
import {
	BASENJI2_REGULATORY_MODEL_ID,
	BOLTZ2_MODEL_ID,
	BORZOI_K562_RNA_MODEL_ID,
	CELLTYPIST_MODEL_ID,
	CHAI1_MODEL_ID,
	ENFORMER_REGULATORY_MODEL_ID,
	ESM2_8M_ID,
	MOCK_AI_MODEL_ID,
	NUCLEOTIDE_TRANSFORMER_500M_ID,
	NUCLEOTIDE_TRANSFORMER_50M_ID
} from './model-registry';

export type AIModelRuntimeFamily =
	| 'development-fixture'
	| 'single-cell-celltypist'
	| 'sequence-transformers'
	| 'regulatory-enformer'
	| 'regulatory-basenji2-human'
	| 'regulatory-borzoi-mini-k562-rna'
	| 'protein-structure-boltz'
	| 'protein-structure-chai';

export type AIModelPreloadKind =
	| 'none'
	| 'celltypist'
	| 'huggingface-transformers'
	| 'tensorflow-hub'
	| 'managed-files';

export type AIRegulatoryBackend = 'enformer' | 'basenji2' | 'borzoi-mini';

export interface AIModelArtifactSpec {
	modelId: string;
	runtimeFamily: AIModelRuntimeFamily;
	preloadKind: AIModelPreloadKind;
	upstreamModelId?: string;
	transformersLoader?: 'auto-model' | 'masked-lm';
	defaultAsset?: string;
	regulatoryBackend?: AIRegulatoryBackend;
	contextWindow?: number;
	defaultHead?: 'human' | 'mouse';
	defaultTargetIndex?: number;
	modelFile?: string;
	paramsFile?: string;
	targetsFile?: string;
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
		modelId: ENFORMER_REGULATORY_MODEL_ID,
		runtimeFamily: 'regulatory-enformer',
		preloadKind: 'tensorflow-hub',
		upstreamModelId: 'https://tfhub.dev/deepmind/enformer/1',
		regulatoryBackend: 'enformer',
		contextWindow: 393_216,
		defaultHead: 'human',
		defaultTargetIndex: 0
	},
	{
		modelId: BASENJI2_REGULATORY_MODEL_ID,
		runtimeFamily: 'regulatory-basenji2-human',
		preloadKind: 'managed-files',
		regulatoryBackend: 'basenji2',
		contextWindow: 131_072,
		defaultHead: 'human',
		defaultTargetIndex: 0,
		modelFile: 'model_human.h5',
		paramsFile: 'params_human.json',
		targetsFile: 'targets_human.txt'
	},
	{
		modelId: BORZOI_K562_RNA_MODEL_ID,
		runtimeFamily: 'regulatory-borzoi-mini-k562-rna',
		preloadKind: 'managed-files',
		regulatoryBackend: 'borzoi-mini',
		contextWindow: 393_216,
		defaultHead: 'human',
		defaultTargetIndex: 0,
		modelFile: 'model0_best.h5',
		paramsFile: 'params.json',
		targetsFile: 'targets.txt'
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

export function regulatoryArtifactForModel(
	model: Pick<LiatirAIModelRecord, 'id' | 'name'>
): (AIModelArtifactSpec & { regulatoryBackend: AIRegulatoryBackend }) | null {
	const spec = artifactSpecForModel(model);
	if (!spec?.regulatoryBackend) return null;
	return spec as AIModelArtifactSpec & { regulatoryBackend: AIRegulatoryBackend };
}

export function requireRegulatoryArtifactForModel(
	model: Pick<LiatirAIModelRecord, 'id' | 'name'>
): AIModelArtifactSpec & { regulatoryBackend: AIRegulatoryBackend } {
	const artifact = regulatoryArtifactForModel(model);
	if (!artifact) throw new Error(`${model.name} is not backed by a regulatory genomics artifact.`);
	return artifact;
}
