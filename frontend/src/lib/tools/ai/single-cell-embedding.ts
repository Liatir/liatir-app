import type {
	JsonValue,
	LiatirAIModelRecord,
	LiatirAIProvenance,
	LiatirAIToolDefinition,
	LiatirFileArtifactRole
} from '@liatir/core';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { aiRunMetadata, type AIRunContext } from '$lib/ai/direct-run-context';
import {
	GENEFORMER_V1_10M_MODEL_ID,
	SCGPT_WHOLE_HUMAN_MODEL_ID,
	UCE_4LAYER_MODEL_ID
} from '$lib/ai/model-registry';
import { cachePathForModel, runAIPython, type AIPythonRunResult } from '$lib/ai/runtime';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';
import { GENEFORMER_EMBEDDING_SCRIPT } from './python-scripts/geneformer-embedding';
import { SCGPT_EMBEDDING_SCRIPT } from './python-scripts/scgpt-embedding';
import { UCE_EMBEDDING_SCRIPT } from './python-scripts/uce-embedding';
import { liatir } from '$lib/api';
import { getLastSegmentsStringFromPath } from '$lib/utils';

export const uceSpeciesOptions = [
	{ value: 'human', label: 'Human' },
	{ value: 'mouse', label: 'Mouse' },
	{ value: 'frog', label: 'Frog' },
	{ value: 'zebrafish', label: 'Zebrafish' },
	{ value: 'mouse_lemur', label: 'Mouse lemur' },
	{ value: 'pig', label: 'Pig' },
	{ value: 'macaca_fascicularis', label: 'Crab-eating macaque' },
	{ value: 'macaca_mulatta', label: 'Rhesus macaque' }
];

export const singleCellEmbeddingDefinition: LiatirAIToolDefinition = {
	id: 'ai-single-cell-embedding',
	type: 'ai-tool',
	label: 'Single-cell Embedding',
	description:
		'Generate local foundation-model cell embeddings from h5ad/AnnData datasets with an isolated managed runtime.',
	category: 'AI Tools',
	inputSchema: {
		modelId: {
			type: 'string',
			label: 'AI Model',
			required: true
		},
		inputFile: {
			type: 'file',
			label: 'AnnData file',
			required: true,
			description:
				'Use raw scRNA-seq counts. UCE expects gene symbols; Geneformer V1 expects human Ensembl IDs.',
			accept: ['h5ad']
		},
		species: {
			type: 'string',
			label: 'Species',
			required: true,
			default: 'human',
			options: uceSpeciesOptions,
			description: 'UCE supports the listed species. Geneformer V1 10M supports Human only.'
		},
		batchSize: {
			type: 'number',
			label: 'Batch size',
			required: false,
			default: 25,
			description: 'Number of cells processed together. Lower values use less memory.',
			connectable: false
		},
		maxCsvRows: {
			type: 'number',
			label: 'CSV preview rows',
			required: false,
			default: 500,
			description: 'Number of embedded cells exported to the lightweight CSV preview.',
			connectable: false
		}
	},
	outputSchema: {
		embeddedAnnData: { type: 'file', label: 'Embedded AnnData', ext: ['h5ad'] },
		embeddingPreviewCsv: { type: 'file', label: 'Embedding preview', ext: ['csv'] },
		summaryJson: { type: 'file', label: 'Embedding summary', ext: ['json'] },
		intermediateFiles: {
			type: 'file',
			label: 'Intermediate files',
			ext: ['h5ad', 'npz', 'pkl', 'torch']
		},
		cellCount: { type: 'number', label: 'Cells', format: 'integer' },
		geneCount: { type: 'number', label: 'Genes', format: 'integer' },
		embeddingDim: { type: 'number', label: 'Embedding dimensions', format: 'integer' },
		provenance: { type: 'json', label: 'Provenance' }
	},
	modelInputKey: 'modelId',
	supportedCapabilities: ['single-cell-embedding'],
	supportedModelIds: [
		UCE_4LAYER_MODEL_ID,
		GENEFORMER_V1_10M_MODEL_ID,
		SCGPT_WHOLE_HUMAN_MODEL_ID
	]
};

function basename(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

function parsePythonJson<T>(stdout: string): T {
	const text = stdout.trim();
	try {
		return JSON.parse(text) as T;
	} catch {
		const lines = text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		for (let i = lines.length - 1; i >= 0; i -= 1) {
			if (!lines[i].startsWith('{')) continue;
			try {
				return JSON.parse(lines[i]) as T;
			} catch {
				// Keep scanning for the final JSON payload.
			}
		}
	}
	throw new Error('Single-cell embedding did not return JSON output.');
}

async function fileArtifact(
	label: string,
	path: string,
	ext: string,
	fieldKey: string,
	role: LiatirFileArtifactRole = 'final'
): Promise<RunOutputFile> {
	let size: number | undefined;
	const api = liatir();
	if (api) {
		try {
			size = (await api.invoke('lia_file_size', { path })) as number;
		} catch {
			/* ok */
		}
	}
	return { label, path, ext, size, fieldKey, role };
}

function extensionFor(path: string): string {
	const name = basename(path);
	if (name.endsWith('.h5ad')) return 'h5ad';
	if (name.endsWith('.npz')) return 'npz';
	if (name.endsWith('.pkl')) return 'pkl';
	if (name.endsWith('.torch')) return 'torch';
	return name.split('.').pop() || 'file';
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(min, Math.min(Math.trunc(parsed), max));
}

export async function finalizeSingleCellEmbeddingResult(
	model: LiatirAIModelRecord,
	inputs: Record<string, string>,
	result: AIPythonRunResult,
	onLog: (line: string) => void
): Promise<{
	outputFiles: RunOutputFile[];
	output: ToolOutput;
	metrics: Record<string, number>;
	values: Record<string, JsonValue>;
}> {
	if (!result.ok) {
		throw new Error(result.stderr || `Single-cell embedding exited with code ${result.exitCode}`);
	}
	if (result.stderr.trim()) onLog(result.stderr.trim());

	const parsed = parsePythonJson<{
		embeddedAnnDataPath: string;
		embeddingPreviewPath: string;
		summaryPath: string;
		intermediatePaths: string[];
		summary: {
			cellCount: number;
			geneCount: number;
			inputCellCount: number | null;
			inputGeneCount: number | null;
			embeddingDim: number;
			embeddingKey: string;
			model: string;
			species: string;
			batchSize: number;
			previewRows: number;
			intermediateCount: number;
			matchedGeneCount?: number;
			accelerator?: string;
			embeddingLayer?: string;
			normalization?: string;
			warnings: string[];
		};
		preview: number[][];
	}>(result.stdout);

	const provenance: LiatirAIProvenance = {
		toolId: singleCellEmbeddingDefinition.id,
		toolLabel: singleCellEmbeddingDefinition.label,
		modelId: model.id,
		modelName: model.name,
		modelVersion: model.version ?? null,
		runtimeKind: model.runtime.kind,
		runtimeName: model.runtime.name,
		runtimeVersion: model.runtime.version ?? null,
		runtimeLock: model.runtimeLock ?? null,
		localOnly: model.localOnly,
		inputSummary: {
			inputFile: basename(inputs.inputFile),
			species: parsed.summary.species,
			inputCellCount: parsed.summary.inputCellCount,
			inputGeneCount: parsed.summary.inputGeneCount
		},
		parameters: {
			batchSize: parsed.summary.batchSize,
			embeddingKey: parsed.summary.embeddingKey,
			csvPreviewRows: parsed.summary.previewRows,
			...(parsed.summary.embeddingLayer ? { embeddingLayer: parsed.summary.embeddingLayer } : {}),
			...(parsed.summary.normalization ? { normalization: parsed.summary.normalization } : {})
		},
		generatedAt: new Date().toISOString()
	};

	const outputFiles = [
		await fileArtifact('Embedded AnnData', parsed.embeddedAnnDataPath, 'h5ad', 'embeddedAnnData'),
		await fileArtifact(
			'Embedding preview CSV',
			parsed.embeddingPreviewPath,
			'csv',
			'embeddingPreviewCsv'
		),
		await fileArtifact('Embedding summary', parsed.summaryPath, 'json', 'summaryJson'),
		...(await Promise.all(
			(parsed.intermediatePaths ?? []).map((path) =>
				fileArtifact(
					`${model.name} intermediate: ${basename(path)}`,
					path,
					extensionFor(path),
					'intermediateFiles',
					'intermediate'
				)
			)
		))
	];
	const provenanceRows: (string | number)[][] = [
		['AI Model', model.name],
		['Runtime', `${model.runtime.name} (${model.runtime.kind})`],
		['Input', basename(inputs.inputFile)],
		['Species', parsed.summary.species],
		['Batch size', parsed.summary.batchSize],
		['Embedding key', parsed.summary.embeddingKey]
	];
	if (parsed.summary.accelerator)
		provenanceRows.push(['Accelerator', parsed.summary.accelerator]);
	if (parsed.summary.embeddingLayer)
		provenanceRows.push(['Embedding layer', parsed.summary.embeddingLayer]);

	return {
		outputFiles,
		output: {
			sections: [
				{
					type: 'stats',
					cols: 4,
					items: [
						{ label: 'Cells', value: parsed.summary.cellCount },
						{ label: 'Genes', value: parsed.summary.geneCount },
						{ label: 'Dimensions', value: parsed.summary.embeddingDim },
						{ label: 'Species', value: parsed.summary.species }
					]
				},
				{
					type: 'single-cell-viewer',
					label: `${model.name} embeddings`,
					description:
						`Lightweight preview. The full embedding matrix is stored in the embedded AnnData artifact under obsm["${parsed.summary.embeddingKey}"].`,
					config: {
						title: `${model.name} embeddings`,
						source: getLastSegmentsStringFromPath(parsed.embeddedAnnDataPath, 2),
						embeddingKey: parsed.summary.embeddingKey,
						previewCsv: getLastSegmentsStringFromPath(parsed.embeddingPreviewPath, 2),
						cellCount: parsed.summary.cellCount,
						embeddingDim: parsed.summary.embeddingDim
					},
					height: 360
				},
				{
					type: 'table',
					label: 'Embedding preview',
					headers: [
						'Row',
						...Array.from({ length: parsed.preview[0]?.length ?? 0 }, (_, i) => `dim_${i}`)
					],
					rows: parsed.preview.map((row, index) => [
						`cell_${index + 1}`,
						...row.map((value) => Number(value.toFixed(5)))
					])
				},
				...(parsed.summary.warnings.length > 0
					? [
							{
								type: 'table' as const,
								label: 'Input notes',
								headers: ['Note'],
								rows: parsed.summary.warnings.map((warning) => [warning])
							}
						]
					: []),
				{
					type: 'table',
					label: 'Provenance',
					headers: ['Field', 'Value'],
					rows: provenanceRows
				}
			]
		},
		metrics: {
			cellCount: parsed.summary.cellCount,
			geneCount: parsed.summary.geneCount,
			embeddingDim: parsed.summary.embeddingDim
		},
		values: {
			cellCount: parsed.summary.cellCount,
			geneCount: parsed.summary.geneCount,
			embeddingDim: parsed.summary.embeddingDim,
			provenance: provenance as unknown as JsonValue
		}
	};
}

export async function runSingleCellEmbeddingStep(
	inputs: Record<string, string>,
	outputDir: string,
	onLog: (line: string) => void,
	runContext?: AIRunContext
): Promise<{
	outputFiles: RunOutputFile[];
	output: ToolOutput;
	metrics: Record<string, number>;
	values: Record<string, JsonValue>;
}> {
	await aiModelsStore.init();
	const modelId = inputs.modelId?.trim();
	if (!modelId) throw new Error('AI Model is required.');
	const model = aiModelsStore.byId(modelId);
	if (!model) throw new Error(`Unknown AI Model: ${modelId}`);
	if (
		model.id !== UCE_4LAYER_MODEL_ID &&
		model.id !== GENEFORMER_V1_10M_MODEL_ID &&
		model.id !== SCGPT_WHOLE_HUMAN_MODEL_ID
	)
		throw new Error('Single-cell Embedding requires UCE 4-layer, Geneformer V1 10M, or scGPT Whole-human.');
	if (model.status !== 'installed') throw new Error(`AI Model is not installed: ${model.name}`);
	if (!inputs.inputFile) throw new Error('AnnData file is required.');

	const batchSize = boundedInteger(inputs.batchSize, 25, 1, 256);
	const maxCsvRows = boundedInteger(inputs.maxCsvRows, 500, 1, 5000);
	const species = inputs.species || 'human';
	if (
		(model.id === GENEFORMER_V1_10M_MODEL_ID || model.id === SCGPT_WHOLE_HUMAN_MODEL_ID) &&
		species !== 'human'
	)
		throw new Error(`${model.name} supports human single-cell transcriptomes only.`);
	const cachePath = cachePathForModel(model);

	onLog(`ai-tool ${singleCellEmbeddingDefinition.id}`);
	onLog(`model ${model.id} (${model.runtime.kind})`);
	onLog(`input ${basename(inputs.inputFile)}`);
	onLog(`species ${species}`);

	const script =
		model.id === GENEFORMER_V1_10M_MODEL_ID
			? GENEFORMER_EMBEDDING_SCRIPT
			: model.id === SCGPT_WHOLE_HUMAN_MODEL_ID
				? SCGPT_EMBEDDING_SCRIPT
				: UCE_EMBEDDING_SCRIPT;
	const result = await runAIPython(
		model,
		script,
		{
			inputFile: inputs.inputFile,
			outputDir,
			runtimePath: model.runtimePath ?? model.localPath ?? null,
			modelCacheDir: cachePath,
			species,
			batchSize,
			maxCsvRows
		},
		{
			timeoutSeconds: 14_400,
			jobLabel:
				runContext?.runKind === 'pipeline-step'
					? `${runContext.pipelineName}: ${singleCellEmbeddingDefinition.label}`
					: singleCellEmbeddingDefinition.label,
			metadata: {
				toolId: singleCellEmbeddingDefinition.id,
				...(runContext ? aiRunMetadata(runContext) : {})
			},
			signal: runContext?.signal,
			onJobId: runContext?.onJobId
		}
	);

	return await finalizeSingleCellEmbeddingResult(model, inputs, result, onLog);
}
