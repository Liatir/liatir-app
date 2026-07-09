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
	ESM2_8M_ID,
	NUCLEOTIDE_TRANSFORMER_500M_ID,
	NUCLEOTIDE_TRANSFORMER_50M_ID
} from '$lib/ai/model-registry';
import { huggingFaceArtifactForModel, requireHuggingFaceArtifactForModel } from '$lib/ai/model-artifacts';
import { cachePathForModel, runAIPython, type AIPythonRunResult } from '$lib/ai/runtime';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';
import { SEQUENCE_EMBEDDING_SCRIPT } from './python-scripts/sequence-embedding';
import { liatir } from '$lib/api';

export const sequenceEmbeddingDefinition: LiatirAIToolDefinition = {
	id: 'ai-sequence-embedding',
	type: 'ai-tool',
	label: 'Sequence Embedding',
	description:
		'Generate local DNA/RNA or protein sequence embeddings with managed lightweight foundation models.',
	category: 'AI Tools',
	inputSchema: {
		modelId: {
			type: 'string',
			label: 'AI Model',
			required: true
		},
		moleculeType: {
			type: 'string',
			label: 'Molecule',
			required: true,
			default: 'dna',
			options: [
				{ value: 'dna', label: 'DNA' },
				{ value: 'rna', label: 'RNA' },
				{ value: 'protein', label: 'Protein' }
			]
		},
		inputFile: {
			type: 'file',
			label: 'FASTA file',
			required: false,
			description: 'Used before the inline sequence when both are provided.',
			accept: ['fasta', 'fa', 'faa', 'fna', 'txt']
		},
		sequence: {
			type: 'string',
			label: 'Sequence',
			required: false,
			description: 'Used only when no FASTA file is selected.',
			default: ''
		},
		maxLength: {
			type: 'number',
			label: 'Max tokens',
			required: true,
			default: 1024
		}
	},
	outputSchema: {
		embeddingsCsv: { type: 'file', label: 'Embeddings', ext: ['csv'] },
		summaryJson: { type: 'file', label: 'Embedding summary', ext: ['json'] },
		sequenceCount: { type: 'number', label: 'Sequences', format: 'integer' },
		embeddingDim: { type: 'number', label: 'Embedding dimensions', format: 'integer' },
		provenance: { type: 'json', label: 'Provenance' }
	},
	modelInputKey: 'modelId',
	supportedCapabilities: ['sequence-embedding', 'embedding']
};

function basename(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

function modelSupportsMolecule(model: LiatirAIModelRecord, moleculeType: string): boolean {
	if (moleculeType === 'dna') return model.modalities.includes('dna');
	if (moleculeType === 'rna')
		return model.modalities.includes('rna') || model.modalities.includes('dna');
	if (moleculeType === 'protein') return model.modalities.includes('protein');
	return false;
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
			/* ok */
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
				// Keep scanning for the final JSON payload.
			}
		}
	}
	throw new Error('Sequence embedding did not return JSON output.');
}

export async function finalizeSequenceEmbeddingResult(
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
	const moleculeType = inputs.moleculeType || 'dna';
	const artifact = requireHuggingFaceArtifactForModel(model);
	const hubModelId = artifact.upstreamModelId;
	const hubRevision = artifact.revision;
	const maxLength = Math.max(16, Math.min(Number(inputs.maxLength || 1024), 4096));

	if (!result.ok) {
		throw new Error(result.stderr || `Sequence embedding exited with code ${result.exitCode}`);
	}
	if (result.stderr.trim()) onLog(result.stderr.trim());

	const parsed = parsePythonJson<{
		embeddingPath: string;
		summaryPath: string;
		summary: {
			sequenceCount: number;
			embeddingDim: number;
			model: string;
			moleculeType: string;
			device: string;
			meanSequenceLength: number;
			maxLength: number;
		};
		preview: number[][];
	}>(result.stdout);

	const provenance: LiatirAIProvenance = {
		toolId: sequenceEmbeddingDefinition.id,
		toolLabel: sequenceEmbeddingDefinition.label,
		modelId: model.id,
		modelName: model.name,
		modelVersion: model.version ?? null,
		runtimeKind: model.runtime.kind,
		runtimeName: model.runtime.name,
		runtimeVersion: model.runtime.version ?? null,
		runtimeLock: model.runtimeLock ?? null,
		localOnly: model.localOnly,
		inputSummary: {
			inputFile: inputs.inputFile ? basename(inputs.inputFile) : null,
			inlineSequence: inputs.sequence ? 'provided' : 'not provided',
			inputSource: inputs.inputFile ? 'file' : 'inline',
			moleculeType,
			maxLength
		},
		parameters: {
			hubModelId,
			...(hubRevision ? { hubRevision } : {}),
			pooling: 'attention-mask mean'
		},
		generatedAt: new Date().toISOString()
	};

	const outputFiles = [
		await fileArtifact('Sequence embeddings', parsed.embeddingPath, 'csv', 'embeddingsCsv'),
		await fileArtifact('Embedding summary', parsed.summaryPath, 'json', 'summaryJson')
	];

	return {
		outputFiles,
		output: {
			sections: [
				{
					type: 'stats',
					cols: 4,
					items: [
						{ label: 'Sequences', value: parsed.summary.sequenceCount },
						{ label: 'Dimensions', value: parsed.summary.embeddingDim },
						{ label: 'Device', value: parsed.summary.device },
						{ label: 'Mean length', value: parsed.summary.meanSequenceLength.toFixed(1) }
					]
				},
				{
					type: 'table',
					label: 'Embedding preview',
					headers: [
						'Row',
						...Array.from({ length: parsed.preview[0]?.length ?? 0 }, (_, i) => `dim_${i}`)
					],
					rows: parsed.preview.map((row, index) => [
						`seq_${index + 1}`,
						...row.map((value) => Number(value.toFixed(5)))
					])
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
						['Molecule', moleculeType]
					]
				}
			]
		},
		metrics: {
			sequenceCount: parsed.summary.sequenceCount,
			embeddingDim: parsed.summary.embeddingDim,
			meanSequenceLength: parsed.summary.meanSequenceLength
		},
		values: {
			sequenceCount: parsed.summary.sequenceCount,
			embeddingDim: parsed.summary.embeddingDim,
			meanSequenceLength: parsed.summary.meanSequenceLength,
			provenance: provenance as unknown as JsonValue
		}
	};
}

export async function runSequenceEmbeddingStep(
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
	const moleculeType = inputs.moleculeType || 'dna';
	const modelId = inputs.modelId?.trim();
	if (!modelId) throw new Error('AI Model is required.');
	const model = aiModelsStore.byId(modelId);
	if (!model) throw new Error(`Unknown AI Model: ${modelId}`);
	if (!huggingFaceArtifactForModel(model))
		throw new Error('Sequence Embedding requires Nucleotide Transformer or ESM-2.');
	if (model.status !== 'installed') throw new Error(`AI Model is not installed: ${model.name}`);
	if (!modelSupportsMolecule(model, moleculeType)) {
		throw new Error(`${model.name} does not support ${moleculeType} sequences.`);
	}
	if (!inputs.inputFile && !inputs.sequence?.trim()) {
		throw new Error('Provide a FASTA file or an inline sequence.');
	}

	const maxLength = Math.max(16, Math.min(Number(inputs.maxLength || 1024), 4096));
	const artifact = requireHuggingFaceArtifactForModel(model);
	const hubModelId = artifact.upstreamModelId;
	const hubRevision = artifact.revision;
	const cachePath = cachePathForModel(model);

	onLog(`ai-tool ${sequenceEmbeddingDefinition.id}`);
	onLog(`model ${model.id} (${model.runtime.kind})`);
	onLog(`hub model ${hubModelId}`);
	if (hubRevision) onLog(`hub revision ${hubRevision}`);

	const result = await runAIPython(
		model,
		SEQUENCE_EMBEDDING_SCRIPT,
		{
			inputFile: inputs.inputFile || '',
			sequence: inputs.sequence || '',
			outputDir,
			runtimePath: model.runtimePath ?? model.localPath ?? null,
			modelCacheDir: cachePath,
			hubModelId,
			...(hubRevision ? { hubRevision } : {}),
			transformersLoader: artifact.transformersLoader,
			moleculeType,
			maxLength
		},
		{
			timeoutSeconds: 7200,
			jobLabel:
				runContext?.runKind === 'pipeline-step'
					? `${runContext.pipelineName}: ${sequenceEmbeddingDefinition.label}`
					: sequenceEmbeddingDefinition.label,
			metadata: {
				toolId: sequenceEmbeddingDefinition.id,
				...(runContext ? aiRunMetadata(runContext) : {})
			},
			signal: runContext?.signal,
			onJobId: runContext?.onJobId
		}
	);

	return await finalizeSequenceEmbeddingResult(model, inputs, result, onLog);
}
