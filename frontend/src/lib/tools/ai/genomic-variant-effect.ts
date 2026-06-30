import type {
	JsonValue,
	LiatirAIModelRecord,
	LiatirAIProvenance,
	LiatirAIToolDefinition
} from '@liatir/core';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { aiRunMetadata, type AIRunContext } from '$lib/ai/direct-run-context';
import { NUCLEOTIDE_TRANSFORMER_500M_ID, NUCLEOTIDE_TRANSFORMER_50M_ID } from '$lib/ai/model-registry';
import { cachePathForModel, runAIPython, type AIPythonRunResult } from '$lib/ai/runtime';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';
import { liatir } from '$lib/api';
import { GENOMIC_VARIANT_EFFECT_SCRIPT } from './python-scripts';

const HUB_MODEL_IDS: Record<string, string> = {
	[NUCLEOTIDE_TRANSFORMER_50M_ID]: 'InstaDeepAI/nucleotide-transformer-v2-50m-multi-species',
	[NUCLEOTIDE_TRANSFORMER_500M_ID]: 'InstaDeepAI/nucleotide-transformer-v2-500m-multi-species'
};

export const genomicVariantEffectDefinition: LiatirAIToolDefinition = {
	id: 'ai-genomic-variant-effect',
	type: 'ai-tool',
	label: 'Genomic Variant Effect',
	description:
		'Score VCF variants by comparing Nucleotide Transformer reference and alternate sequence-window embeddings.',
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
			description: 'Used before the inline reference sequence when both are provided.',
			accept: ['fasta', 'fa', 'fna', 'txt']
		},
		sequence: {
			type: 'string',
			label: 'Inline reference sequence',
			required: false,
			description: 'Used only when no reference FASTA file is selected.',
			default: ''
		},
		variantFile: {
			type: 'file',
			label: 'Variant VCF',
			required: true,
			accept: ['vcf']
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
		flankSize: {
			type: 'number',
			label: 'Flank size',
			required: true,
			default: 256
		},
		maxVariants: {
			type: 'number',
			label: 'Max variants',
			required: true,
			default: 20
		},
		maxLength: {
			type: 'number',
			label: 'Max tokens',
			required: true,
			default: 1024
		}
	},
	outputSchema: {
		scoresCsv: { type: 'file', label: 'Variant scores', ext: ['csv'] },
		scoresBed: { type: 'file', label: 'Genome track', ext: ['bed'] },
		summaryJson: { type: 'file', label: 'Score summary', ext: ['json'] },
		variantCount: { type: 'number', label: 'Variants', format: 'integer' },
		topScore: { type: 'number', label: 'Top embedding delta', format: 'decimal' },
		provenance: { type: 'json', label: 'Provenance' }
	},
	modelInputKey: 'modelId',
	supportedCapabilities: ['variant-effect-scoring']
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
	throw new Error('Genomic variant effect scoring did not return JSON output.');
}

function modelSupportsVariantEffect(model: LiatirAIModelRecord): boolean {
	return (
		model.capabilities.includes('variant-effect-scoring') &&
		(model.modalities.includes('dna') || model.modalities.includes('rna'))
	);
}

export async function finalizeGenomicVariantEffectResult(
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
	const hubModelId = HUB_MODEL_IDS[model.id];
	const hubRevision = model.install?.revision;
	const flankSize = asNumber(inputs.flankSize, 256, 1, 4096);
	const maxVariants = asNumber(inputs.maxVariants, 20, 1, 1000);
	const maxLength = asNumber(inputs.maxLength, 1024, 16, 4096);
	const windowStart = asNumber(inputs.windowStart, 1, 1, Number.MAX_SAFE_INTEGER);

	if (!result.ok) {
		throw new Error(result.stderr || `Genomic variant effect scoring exited with code ${result.exitCode}`);
	}
	if (result.stderr.trim()) onLog(result.stderr.trim());

	const parsed = parsePythonJson<{
		scoresPath: string;
		bedPath: string;
		summaryPath: string;
		summary: {
			variantCount: number;
			referenceName: string;
			windowStart: number;
			referenceLength: number;
			device: string;
			flankSize: number;
			maxLength: number;
			warnings: string[];
			topVariant: {
				variantId: string;
				chrom: string;
				pos: number;
				ref: string;
				alt: string;
				cosineDistance: number;
				l2Delta: number;
				score: number;
			};
		};
		preview: Array<Record<string, string | number | boolean>>;
	}>(result.stdout);

	const provenance: LiatirAIProvenance = {
		toolId: genomicVariantEffectDefinition.id,
		toolLabel: genomicVariantEffectDefinition.label,
		modelId: model.id,
		modelName: model.name,
		modelVersion: model.version ?? null,
		runtimeKind: model.runtime.kind,
		runtimeName: model.runtime.name,
		runtimeVersion: model.runtime.version ?? null,
		localOnly: model.localOnly,
		inputSummary: {
			referenceFile: inputs.referenceFile ? basename(inputs.referenceFile) : null,
			inlineReference: inputs.sequence ? 'provided' : 'not provided',
			inputSource: inputs.referenceFile ? 'file' : 'inline',
			variantFile: inputs.variantFile ? basename(inputs.variantFile) : null,
			referenceName: inputs.referenceName || parsed.summary.referenceName,
			windowStart,
			flankSize,
			maxVariants,
			maxLength
		},
		parameters: {
			hubModelId,
			...(hubRevision ? { hubRevision } : {}),
			scoring: '1 - cosine_similarity(reference_embedding, alternate_embedding)'
		},
		generatedAt: new Date().toISOString()
	};

	const outputFiles = [
		await fileArtifact('Variant effect scores', parsed.scoresPath, 'csv', 'scoresCsv'),
		await fileArtifact('Variant effect BED track', parsed.bedPath, 'bed', 'scoresBed'),
		await fileArtifact('Variant effect summary', parsed.summaryPath, 'json', 'summaryJson')
	];

	const topScore = parsed.summary.topVariant?.cosineDistance ?? 0;
	const viewStart = Math.max(0, parsed.summary.topVariant.pos - flankSize);
	const viewEnd = parsed.summary.topVariant.pos + flankSize;
	const rows = parsed.preview.map((row) => [
		String(row.variantId),
		String(row.chrom),
		Number(row.pos),
		String(row.ref),
		String(row.alt),
		Number(row.cosineDistance).toFixed(6),
		Number(row.l2Delta).toFixed(4),
		String(row.refMatch)
	]);

	return {
		outputFiles,
		output: {
			sections: [
				{
					type: 'stats',
					cols: 4,
					items: [
						{ label: 'Variants scored', value: parsed.summary.variantCount },
						{ label: 'Top delta', value: topScore.toFixed(6) },
						{ label: 'Device', value: parsed.summary.device },
						{ label: 'Warnings', value: parsed.summary.warnings.length }
					]
				},
				{
					type: 'table',
					label: 'Variant effect preview',
					headers: ['Variant', 'Chrom', 'Pos', 'Ref', 'Alt', 'Cosine delta', 'L2 delta', 'REF match'],
					rows
				},
				...(parsed.summary.warnings.length > 0
					? [{
							type: 'text' as const,
							label: 'Warnings',
							content: parsed.summary.warnings.join('\n'),
							mono: true
						}]
					: []),
				{
					type: 'genome-viewer',
					label: 'Variant effect track',
					description: 'BED score track from Nucleotide Transformer embedding deltas.',
					assembly: {
						name: parsed.summary.referenceName || 'reference',
						fastaPath: inputs.referenceFile || undefined,
						refName: parsed.summary.topVariant.chrom,
						start: viewStart,
						end: viewEnd
					},
					tracks: [
						{
							name: 'Variant effect score',
							kind: 'bed',
							path: parsed.bedPath,
							category: 'AI'
						}
					],
					height: 360
				},
				{
					type: 'table',
					label: 'Provenance',
					headers: ['Field', 'Value'],
					rows: [
						['AI Model', model.name],
						['Hub model', hubModelId],
						['Hub revision', hubRevision ?? 'not pinned'],
						['Runtime', `${model.runtime.name} (${model.runtime.kind})`],
						['Scoring', 'embedding delta']
					]
				}
			]
		},
		metrics: {
			variantCount: parsed.summary.variantCount,
			topScore,
			warningCount: parsed.summary.warnings.length
		},
		values: {
			variantCount: parsed.summary.variantCount,
			topScore,
			warningCount: parsed.summary.warnings.length,
			provenance: provenance as unknown as JsonValue
		}
	};
}

export async function runGenomicVariantEffectStep(
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
	if (!HUB_MODEL_IDS[model.id]) {
		throw new Error('Genomic Variant Effect requires a Nucleotide Transformer model.');
	}
	if (model.status !== 'installed') throw new Error(`AI Model is not installed: ${model.name}`);
	if (!modelSupportsVariantEffect(model)) {
		throw new Error(`${model.name} does not support genomic variant effect scoring.`);
	}
	if (!inputs.referenceFile && !inputs.sequence?.trim()) {
		throw new Error('Provide a reference FASTA file or an inline reference sequence.');
	}
	if (!inputs.variantFile) throw new Error('Variant VCF file is required.');

	const hubModelId = HUB_MODEL_IDS[model.id];
	const hubRevision = model.install?.revision;
	const flankSize = asNumber(inputs.flankSize, 256, 1, 4096);
	const maxVariants = asNumber(inputs.maxVariants, 20, 1, 1000);
	const maxLength = asNumber(inputs.maxLength, 1024, 16, 4096);
	const windowStart = asNumber(inputs.windowStart, 1, 1, Number.MAX_SAFE_INTEGER);
	const cachePath = cachePathForModel(model);

	onLog(`ai-tool ${genomicVariantEffectDefinition.id}`);
	onLog(`model ${model.id} (${model.runtime.kind})`);
	onLog(`hub model ${hubModelId}`);
	if (hubRevision) onLog(`hub revision ${hubRevision}`);
	if (inputs.referenceFile) onLog(`reference ${basename(inputs.referenceFile)}`);
	onLog(`variants ${basename(inputs.variantFile)}`);

	const result = await runAIPython(
		model,
		GENOMIC_VARIANT_EFFECT_SCRIPT,
		{
			referenceFile: inputs.referenceFile || '',
			sequence: inputs.sequence || '',
			variantFile: inputs.variantFile || '',
			referenceName: inputs.referenceName || '',
			outputDir,
			runtimePath: model.runtimePath ?? model.localPath ?? null,
			modelCacheDir: cachePath,
			hubModelId,
			...(hubRevision ? { hubRevision } : {}),
			windowStart,
			flankSize,
			maxVariants,
			maxLength
		},
		{
			timeoutSeconds: 7200,
			jobLabel:
				runContext?.runKind === 'pipeline-step'
					? `${runContext.pipelineName}: ${genomicVariantEffectDefinition.label}`
					: genomicVariantEffectDefinition.label,
			metadata: {
				toolId: genomicVariantEffectDefinition.id,
				...(runContext ? aiRunMetadata(runContext) : {})
			}
		}
	);

	return await finalizeGenomicVariantEffectResult(model, inputs, result, onLog);
}
