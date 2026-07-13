/**
 * The one place that says, for each AI Model, *what its weights are and how to obtain them*.
 *
 * The model registry describes a model to the user (name, description, size). This describes it to
 * the code: which runtime family it belongs to, how its assets are fetched, and — for the models
 * that need it — which specific files inside the download are the weights, the parameters and the
 * output targets.
 *
 * Keeping it in a single table rather than scattered through each tool is what lets a new model be
 * added by appending one entry, and what guarantees the preloader, the runner and the UI all agree
 * on the same facts about it.
 */
import type { LiatirAIModelMetadata, LiatirAIModelRecord } from '@liatir/core';
import {
	BASENJI2_REGULATORY_MODEL_ID,
	BOLTZ2_MODEL_ID,
	BORZOI_K562_RNA_MODEL_ID,
	CELLTYPIST_MODEL_ID,
	CHAI1_MODEL_ID,
	ENFORMER_REGULATORY_MODEL_ID,
	ESM2_8M_ID,
	GENEFORMER_V1_10M_MODEL_ID,
	MOCK_AI_MODEL_ID,
	NUCLEOTIDE_TRANSFORMER_500M_ID,
	NUCLEOTIDE_TRANSFORMER_50M_ID,
	SCFOUNDATION_100M_MODEL_ID,
	SCGPT_WHOLE_HUMAN_MODEL_ID,
	UCE_4LAYER_MODEL_ID
} from './model-registry';

/**
 * Which Python code path runs this model. Models in the same family share a runner and a runtime,
 * which is why several models can be backed by one installed environment.
 */
export type AIModelRuntimeFamily =
	| 'development-fixture'
	| 'single-cell-celltypist'
	| 'sequence-transformers'
	| 'regulatory-enformer'
	| 'regulatory-basenji2-human'
	| 'regulatory-borzoi-mini-k562-rna'
	| 'single-cell-foundation-scgpt'
	| 'single-cell-foundation-geneformer'
	| 'single-cell-foundation-uce'
	| 'single-cell-foundation-scfoundation'
	| 'protein-structure-boltz'
	| 'protein-structure-chai';

/**
 * How the weights are fetched at install time. `none` means the runtime pulls them itself on first
 * use (Boltz and Chai do this), so there is nothing for the preloader to do.
 */
export type AIModelPreloadKind =
	| 'none'
	| 'celltypist'
	| 'huggingface-transformers'
	| 'tensorflow-hub'
	| 'managed-files';

export type AIRegulatoryBackend = 'enformer' | 'basenji2' | 'borzoi-mini';

/** Most fields are optional because they only apply to some families — see the table below. */
export interface AIModelArtifactSpec {
	modelId: string;
	runtimeFamily: AIModelRuntimeFamily;
	preloadKind: AIModelPreloadKind;
	/** The model's ID upstream (Hugging Face repo, TF Hub URL) — not Liatir's own ID. */
	upstreamModelId?: string;
	/** Which Transformers class loads it: the wrong one yields a model that loads but cannot infer. */
	transformersLoader?: 'auto-model' | 'masked-lm';
	defaultAsset?: string;
	regulatoryBackend?: AIRegulatoryBackend;
	/** Regulatory models: how many base pairs of sequence the model consumes at once. */
	contextWindow?: number;
	defaultHead?: 'human' | 'mouse';
	defaultTargetIndex?: number;
	// For models delivered as loose files, the paths *inside* the download that matter.
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
		modelId: SCGPT_WHOLE_HUMAN_MODEL_ID,
		runtimeFamily: 'single-cell-foundation-scgpt',
		preloadKind: 'managed-files',
		modelFile: 'best_model.pt'
	},
	{
		modelId: GENEFORMER_V1_10M_MODEL_ID,
		runtimeFamily: 'single-cell-foundation-geneformer',
		preloadKind: 'managed-files',
		modelFile: 'model/model.safetensors'
	},
	{
		modelId: UCE_4LAYER_MODEL_ID,
		runtimeFamily: 'single-cell-foundation-uce',
		preloadKind: 'managed-files',
		modelFile: 'model_files/4layer_model.torch'
	},
	{
		modelId: SCFOUNDATION_100M_MODEL_ID,
		runtimeFamily: 'single-cell-foundation-scfoundation',
		preloadKind: 'none'
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

/**
 * The `require*` variants throw instead of returning null, and are used where a missing spec is a
 * programming error rather than a condition to handle. They carry the model's display *name* in the
 * message, so the failure names the model the user recognises rather than an internal ID.
 */
export function requireArtifactSpecForModel(
	model: Pick<LiatirAIModelMetadata | LiatirAIModelRecord, 'id' | 'name'>
): AIModelArtifactSpec {
	const spec = artifactSpecForModel(model);
	if (!spec) throw new Error(`Missing AI artifact spec for ${model.name}.`);
	return spec;
}

/**
 * Everything needed to pull a model from Hugging Face, or null if it does not come from there.
 *
 * The revision comes from the model's install metadata, not from this table: pinning a specific
 * commit is what stops an upstream repository update from silently changing the weights a user's
 * results were produced with.
 */
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
