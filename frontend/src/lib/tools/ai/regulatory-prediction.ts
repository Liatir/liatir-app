import type {
	JsonValue,
	LiatirAIModelRecord,
	LiatirAIProvenance,
	LiatirAIToolDefinition
} from '@liatir/core';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { aiRunMetadata, type AIRunContext } from '$lib/ai/direct-run-context';
import {
	BASENJI2_REGULATORY_MODEL_ID,
	BORZOI_K562_RNA_MODEL_ID,
	ENFORMER_REGULATORY_MODEL_ID
} from '$lib/ai/model-registry';
import { cachePathForModel, runAIPython, type AIPythonRunResult } from '$lib/ai/runtime';
import { runtimeBoxResultProvenance } from '$lib/ai/runtime-box-provenance';
import { requireRegulatoryArtifactForModel, regulatoryArtifactForModel } from '$lib/ai/model-artifacts';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';
import { liatir } from '$lib/api';
import { REGULATORY_PREDICTION_SCRIPT } from './python-scripts/regulatory-prediction';

const SUPPORTED_REGULATORY_MODEL_IDS = [
	ENFORMER_REGULATORY_MODEL_ID,
	BASENJI2_REGULATORY_MODEL_ID,
	BORZOI_K562_RNA_MODEL_ID
];

export const regulatoryPredictionDefinition: LiatirAIToolDefinition = {
	id: 'ai-regulatory-prediction',
	type: 'ai-tool',
	label: 'Regulatory Prediction',
	description:
		'Predict regulatory signal from genomic sequence windows and optionally score VCF variants with regulatory genomics models.',
	category: 'AI Tools',
	inputSchema: {
		modelId: {
			type: 'string',
			label: 'AI Model',
			required: true
		},
		referenceFile: {
			type: 'file',
			label: 'Reference FASTA',
			required: false,
			description: 'Used before the inline sequence when both are provided.',
			accept: ['fasta', 'fa', 'fna', 'txt']
		},
		sequence: {
			type: 'string',
			label: 'Inline sequence',
			required: false,
			description: 'Used only when no reference FASTA file is selected.',
			default: ''
		},
		variantFile: {
			type: 'file',
			label: 'Variant VCF',
			required: false,
			accept: ['vcf', 'vcf.gz']
		},
		referenceName: {
			type: 'string',
			label: 'Reference name',
			required: false,
			default: ''
		},
		windowStart: {
			type: 'number',
			label: 'Window start',
			required: true,
			default: 1
		},
		outputHead: {
			type: 'string',
			label: 'Output head',
			required: true,
			default: 'human',
			options: [
				{ value: 'human', label: 'Human' },
				{ value: 'mouse', label: 'Mouse' }
			]
		},
		targetIndex: {
			type: 'number',
			label: 'Target index',
			required: true,
			default: 0
		},
		maxVariants: {
			type: 'number',
			label: 'Max variants',
			required: true,
			default: 10
		}
	},
	outputSchema: {
		signalCsv: { type: 'file', label: 'Predicted signal', ext: ['csv'] },
		signalBed: { type: 'file', label: 'Signal genome track', ext: ['bed'] },
		variantScoresCsv: { type: 'file', label: 'Variant scores', ext: ['csv'] },
		variantScoresBed: { type: 'file', label: 'Variant score track', ext: ['bed'] },
		summaryJson: { type: 'file', label: 'Prediction summary', ext: ['json'] },
		binCount: { type: 'number', label: 'Bins', format: 'integer' },
		variantCount: { type: 'number', label: 'Variants', format: 'integer' },
		topScore: { type: 'number', label: 'Top variant delta', format: 'decimal' },
		provenance: { type: 'json', label: 'Provenance' }
	},
	modelInputKey: 'modelId',
	supportedCapabilities: ['regulatory-prediction'],
	supportedModelIds: SUPPORTED_REGULATORY_MODEL_IDS
};

function basename(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

function asNumber(value: string | undefined, fallback: number, min: number, max: number): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(min, Math.min(parsed, max));
}

async function fileArtifact(
	label: string,
	path: string,
	ext: string,
	fieldKey: string
): Promise<RunOutputFile> {
	let size: number | undefined;
	const api = liatir();
	if (api) {
		try {
			size = (await api.invoke('lia_file_size', { path })) as number;
		} catch {
			/* optional */
		}
	}
	return { label, path, ext, size, fieldKey };
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
				// Keep scanning for the final JSON object.
			}
		}
	}
	throw new Error('Regulatory prediction did not return JSON output.');
}

function modelSupportsRegulatoryPrediction(model: LiatirAIModelRecord): boolean {
	return (
		model.capabilities.includes('regulatory-prediction') &&
		SUPPORTED_REGULATORY_MODEL_IDS.includes(model.id)
	);
}

export async function finalizeRegulatoryPredictionResult(
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
	const artifact = requireRegulatoryArtifactForModel(model);
	if (!result.ok) {
		throw new Error(result.stderr || `Regulatory prediction exited with code ${result.exitCode}`);
	}
	if (result.stderr.trim()) onLog(result.stderr.trim());

	const parsed = parsePythonJson<{
		signalCsvPath: string;
		signalBedPath: string;
		variantCsvPath: string;
		variantBedPath: string;
		summaryPath: string;
		summary: {
			backend: string;
			modelSource: string;
			referenceName: string;
			referenceLength: number;
			windowStart: number;
			contextWindow: number;
			outputHead: string;
			targetIndex: number;
			binCount: number;
			meanSignal: number;
			maxSignal: number;
			variantCount: number;
			topVariant: null | {
				variantId: string;
				chrom: string;
				pos: number;
				ref: string;
				alt: string;
				meanDelta: number;
				maxAbsDelta: number;
				refMatch: boolean;
			};
			warnings: string[];
		};
		signalPreview: Array<Record<string, string | number | boolean>>;
		variantPreview: Array<Record<string, string | number | boolean>>;
	}>(result.stdout);

	const provenance: LiatirAIProvenance = {
		toolId: regulatoryPredictionDefinition.id,
		toolLabel: regulatoryPredictionDefinition.label,
		modelId: model.id,
		modelName: model.name,
		modelVersion: model.version ?? null,
		runtimeKind: model.runtime.kind,
		runtimeName: model.runtime.name,
		runtimeVersion: model.runtime.version ?? null,
		runtimeLock: model.runtimeLock ?? null,
		...runtimeBoxResultProvenance(result),
		localOnly: model.localOnly,
		inputSummary: {
			referenceFile: inputs.referenceFile ? basename(inputs.referenceFile) : null,
			inlineReference: inputs.sequence ? 'provided' : 'not provided',
			variantFile: inputs.variantFile ? basename(inputs.variantFile) : null,
			referenceName: inputs.referenceName || parsed.summary.referenceName,
			windowStart: parsed.summary.windowStart
		},
		parameters: {
			backend: artifact.regulatoryBackend,
			contextWindow: parsed.summary.contextWindow,
			outputHead: parsed.summary.outputHead,
			targetIndex: parsed.summary.targetIndex,
			modelSource: parsed.summary.modelSource
		},
		generatedAt: new Date().toISOString()
	};

	const outputFiles = [
		await fileArtifact('Regulatory signal CSV', parsed.signalCsvPath, 'csv', 'signalCsv'),
		await fileArtifact('Regulatory signal BED track', parsed.signalBedPath, 'bed', 'signalBed'),
		await fileArtifact('Regulatory prediction summary', parsed.summaryPath, 'json', 'summaryJson')
	];
	if (parsed.variantCsvPath) {
		outputFiles.push(
			await fileArtifact('Regulatory variant scores', parsed.variantCsvPath, 'csv', 'variantScoresCsv')
		);
	}
	if (parsed.variantBedPath) {
		outputFiles.push(
			await fileArtifact('Regulatory variant BED track', parsed.variantBedPath, 'bed', 'variantScoresBed')
		);
	}

	const signalRows = parsed.signalPreview.map((row) => [
		Number(row.binIndex),
		String(row.chrom),
		Number(row.start),
		Number(row.end),
		Number(row.value).toFixed(6)
	]);
	const variantRows = parsed.variantPreview.map((row) => [
		String(row.variantId),
		String(row.chrom),
		Number(row.pos),
		String(row.ref),
		String(row.alt),
		Number(row.meanDelta).toFixed(6),
		Number(row.maxAbsDelta).toFixed(6),
		String(row.refMatch)
	]);
	const topScore = parsed.summary.topVariant?.meanDelta ?? 0;
	const viewStart = Math.max(0, parsed.summary.windowStart - 1);
	const viewEnd = viewStart + Math.min(parsed.summary.referenceLength, parsed.summary.contextWindow);

	return {
		outputFiles,
		output: {
			sections: [
				{
					type: 'stats',
					cols: 4,
					items: [
						{ label: 'Prediction bins', value: parsed.summary.binCount },
						{ label: 'Mean signal', value: parsed.summary.meanSignal.toFixed(4) },
						{ label: 'Variants scored', value: parsed.summary.variantCount },
						{ label: 'Warnings', value: parsed.summary.warnings.length }
					]
				},
				{
					type: 'table',
					label: 'Signal preview',
					headers: ['Bin', 'Chrom', 'Start', 'End', 'Value'],
					rows: signalRows
				},
				...(variantRows.length > 0
					? [
							{
								type: 'table' as const,
								label: 'Variant score preview',
								headers: ['Variant', 'Chrom', 'Pos', 'Ref', 'Alt', 'Mean delta', 'Max abs delta', 'REF match'],
								rows: variantRows
							}
						]
					: []),
				...(parsed.summary.warnings.length > 0
					? [
							{
								type: 'text' as const,
								label: 'Warnings',
								content: parsed.summary.warnings.join('\n'),
								mono: true
							}
						]
					: []),
				{
					type: 'genome-viewer',
					label: 'Regulatory prediction tracks',
					description: 'BED tracks generated from model signal and optional variant scores.',
					assembly: {
						name: parsed.summary.referenceName || 'reference',
						fastaPath: inputs.referenceFile || undefined,
						refName: parsed.summary.referenceName,
						start: viewStart,
						end: viewEnd
					},
					tracks: [
						{
							name: 'Regulatory signal',
							kind: 'bed',
							path: parsed.signalBedPath,
							category: 'AI'
						},
						...(parsed.variantBedPath
							? [
									{
										name: 'Variant regulatory delta',
										kind: 'bed' as const,
										path: parsed.variantBedPath,
										category: 'AI'
									}
								]
							: [])
					],
					height: 360
				},
				{
					type: 'table',
					label: 'Provenance',
					headers: ['Field', 'Value'],
					rows: [
						['AI Model', model.name],
						['Backend', artifact.regulatoryBackend],
						['Runtime', `${model.runtime.name} (${model.runtime.kind})`],
						['Context window', parsed.summary.contextWindow],
						['Target index', parsed.summary.targetIndex]
					]
				}
			]
		},
		metrics: {
			binCount: parsed.summary.binCount,
			variantCount: parsed.summary.variantCount,
			topScore,
			warningCount: parsed.summary.warnings.length
		},
		values: {
			binCount: parsed.summary.binCount,
			variantCount: parsed.summary.variantCount,
			topScore,
			warningCount: parsed.summary.warnings.length,
			provenance: provenance as unknown as JsonValue
		}
	};
}

export async function runRegulatoryPredictionStep(
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
	const artifact = regulatoryArtifactForModel(model);
	if (!artifact) throw new Error('Regulatory Prediction requires Enformer, Basenji2, or Borzoi Mini.');
	if (model.status !== 'installed') throw new Error(`AI Model is not installed: ${model.name}`);
	if (!modelSupportsRegulatoryPrediction(model)) {
		throw new Error(`${model.name} does not support regulatory prediction in Liatir.`);
	}
	if (!inputs.referenceFile && !inputs.sequence?.trim()) {
		throw new Error('Provide a reference FASTA file or an inline sequence.');
	}

	const contextWindow = artifact.contextWindow ?? model.contextWindow ?? 0;
	const outputHead = inputs.outputHead || artifact.defaultHead || 'human';
	const targetIndex = asNumber(inputs.targetIndex, artifact.defaultTargetIndex ?? 0, 0, 100_000);
	const windowStart = asNumber(inputs.windowStart, 1, 1, Number.MAX_SAFE_INTEGER);
	const maxVariants = asNumber(inputs.maxVariants, 10, 0, 1000);
	const cachePath = cachePathForModel(model);

	onLog(`ai-tool ${regulatoryPredictionDefinition.id}`);
	onLog(`model ${model.id} (${model.runtime.kind})`);
	onLog(`backend ${artifact.regulatoryBackend}`);
	if (inputs.referenceFile) onLog(`reference ${basename(inputs.referenceFile)}`);
	if (inputs.variantFile) onLog(`variants ${basename(inputs.variantFile)}`);

	const result = await runAIPython(
		model,
		REGULATORY_PREDICTION_SCRIPT,
		{
			backend: artifact.regulatoryBackend,
			referenceFile: inputs.referenceFile || '',
			sequence: inputs.sequence || '',
			variantFile: inputs.variantFile || '',
			referenceName: inputs.referenceName || '',
			outputDir,
			runtimePath: model.runtimePath ?? model.localPath ?? null,
			modelCacheDir: cachePath,
			contextWindow,
			outputHead,
			targetIndex,
			windowStart,
			maxVariants,
			...(artifact.upstreamModelId ? { tfhubUrl: artifact.upstreamModelId } : {}),
			...(artifact.modelFile ? { modelFile: artifact.modelFile } : {}),
			...(artifact.paramsFile ? { paramsFile: artifact.paramsFile } : {}),
			...(artifact.targetsFile ? { targetsFile: artifact.targetsFile } : {})
		},
		{
			timeoutSeconds: 14_400,
			jobLabel:
				runContext?.runKind === 'pipeline-step'
					? `${runContext.pipelineName}: ${regulatoryPredictionDefinition.label}`
					: regulatoryPredictionDefinition.label,
			metadata: {
				toolId: regulatoryPredictionDefinition.id,
				...(runContext ? aiRunMetadata(runContext) : {})
			},
			signal: runContext?.signal,
			onJobId: runContext?.onJobId
		}
	);

	return await finalizeRegulatoryPredictionResult(model, inputs, result, onLog);
}
