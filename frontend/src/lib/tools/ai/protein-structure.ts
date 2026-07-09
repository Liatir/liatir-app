import type {
	JsonValue,
	LiatirAIModelRecord,
	LiatirAIProvenance,
	LiatirAIToolDefinition
} from '@liatir/core';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { aiRunMetadata, type AIRunContext } from '$lib/ai/direct-run-context';
import { BOLTZ2_MODEL_ID, CHAI1_MODEL_ID } from '$lib/ai/model-registry';
import {
	cachePathForModel,
	getAIHardwareInfo,
	runAIPython,
	type AIPythonRunResult
} from '$lib/ai/runtime';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';
import { PROTEIN_STRUCTURE_SCRIPT } from './python-scripts/protein-structure';
import { liatir } from '$lib/api';

const BACKENDS: Record<string, 'boltz2' | 'chai1'> = {
	[BOLTZ2_MODEL_ID]: 'boltz2',
	[CHAI1_MODEL_ID]: 'chai1'
};

export const proteinStructureDefinition: LiatirAIToolDefinition = {
	id: 'ai-protein-structure',
	type: 'ai-tool',
	label: 'Protein Structure Prediction',
	description:
		'Predict protein structures and optional protein-ligand binding outputs with managed local structure models.',
	category: 'AI Tools',
	inputSchema: {
		modelId: {
			type: 'string',
			label: 'AI Model',
			required: true
		},
		inputFile: {
			type: 'file',
			label: 'Protein FASTA',
			required: false,
			description: 'Used before the inline protein sequence when both are provided.',
			accept: ['fasta', 'fa', 'faa', 'txt']
		},
		sequence: {
			type: 'string',
			label: 'Protein sequence',
			required: false,
			description: 'Used only when no protein FASTA file is selected.',
			default: ''
		},
		ligandSmiles: {
			type: 'string',
			label: 'Ligand SMILES',
			required: false,
			default: ''
		},
		ligandCcd: {
			type: 'string',
			label: 'Ligand CCD',
			required: false,
			default: ''
		},
		useMsaServer: {
			type: 'boolean',
			label: 'Use MSA server',
			required: false,
			default: true
		},
		predictAffinity: {
			type: 'boolean',
			label: 'Predict affinity',
			required: false,
			default: true
		},
		accelerator: {
			type: 'string',
			label: 'Accelerator',
			required: false,
			default: 'cpu',
			options: [
				{ value: 'cpu', label: 'CPU' },
				{ value: 'gpu', label: 'GPU' }
			]
		},
		outputFormat: {
			type: 'string',
			label: 'Output format',
			required: false,
			default: 'mmcif',
			options: [
				{ value: 'mmcif', label: 'mmCIF' },
				{ value: 'pdb', label: 'PDB' }
			]
		},
		recyclingSteps: {
			type: 'number',
			label: 'Recycling steps',
			required: false,
			default: 3
		},
		diffusionSamples: {
			type: 'number',
			label: 'Diffusion samples',
			required: false,
			default: 1
		},
		usePotentials: {
			type: 'boolean',
			label: 'Use potentials',
			required: false,
			default: false
		},
		noKernels: {
			type: 'boolean',
			label: 'Disable CUDA kernels',
			required: false,
			default: false
		}
	},
	outputSchema: {
		structureFile: { type: 'file', label: 'Predicted structure', ext: ['cif', 'pdb'] },
		summaryJson: { type: 'file', label: 'Prediction summary', ext: ['json'] },
		confidenceJson: { type: 'file', label: 'Confidence scores', ext: ['json'] },
		affinityJson: { type: 'file', label: 'Affinity scores', ext: ['json'] },
		confidenceScore: { type: 'number', label: 'Confidence', format: 'decimal' },
		affinityProbability: { type: 'number', label: 'Binding probability', format: 'percent' },
		provenance: { type: 'json', label: 'Provenance' }
	},
	modelInputKey: 'modelId',
	supportedCapabilities: ['protein-structure-prediction', 'protein-binding']
};

function basename(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

function numberInput(
	value: string | undefined,
	fallback: number,
	min: number,
	max: number
): number {
	const parsed = Number(value ?? fallback);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(min, Math.min(max, Math.round(parsed)));
}

function boolInput(value: string | undefined, fallback: boolean): boolean {
	if (value == null || value === '') return fallback;
	return value === 'true';
}

function structureFormat(path: string, fallback: string): 'pdb' | 'mmcif' {
	if (path.toLowerCase().endsWith('.pdb')) return 'pdb';
	if (path.toLowerCase().endsWith('.cif') || path.toLowerCase().endsWith('.mmcif')) return 'mmcif';
	return fallback === 'pdb' ? 'pdb' : 'mmcif';
}

async function fileArtifact(
	label: string,
	path: string | null | undefined,
	ext: string,
	fieldKey: string
): Promise<RunOutputFile | null> {
	if (!path) return null;
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

function modelSupportsStructure(model: LiatirAIModelRecord): boolean {
	return model.capabilities.includes('protein-structure-prediction');
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
	throw new Error('Protein structure prediction did not return JSON output.');
}

function compactPythonError(stderr: string, fallback: string): string {
	const lines = stderr
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	const isTracebackContext = (line: string): boolean =>
		line.startsWith('File "') ||
		line.startsWith('Traceback ') ||
		line.startsWith('During handling ') ||
		line.startsWith('The above exception ') ||
		line.startsWith('^') ||
		/^[A-Za-z_][\w.]*\([^)]*\)$/.test(line) ||
		/^[A-Za-z_][\w.]*\([^)]*\)(?:\.[A-Za-z_][\w.]*\([^)]*\))+$/.test(line) ||
		line === 'return None';

	const looksLikeException = (line: string): boolean =>
		/^(?:[A-Za-z_][\w.]*)(?:Error|Exception|Warning|Exit|Interrupt):\s+.+/.test(line) ||
		/^(?:RuntimeError|ValueError|TypeError|ImportError|ModuleNotFoundError|SystemExit):\s+.+/.test(
			line
		);
	const looksLikeNonFatalLibraryWarning = (line: string): boolean =>
		line.includes('UserWarning:') ||
		line.includes('FutureWarning:') ||
		line.includes('DeprecationWarning:') ||
		line.includes('GPU available but not used') ||
		line.includes('Starting from v') ||
		line.includes('Consider setting `persistent_workers=True`') ||
		line.includes('pin_memory');

	const explicit = [...lines]
		.reverse()
		.find(
			(line) =>
				line.startsWith('Boltz completed') ||
				line.startsWith('Chai-1') ||
				line.startsWith('Model command failed') ||
				line.includes('Model command failed') ||
				line.startsWith('Provide ') ||
				line.startsWith('Unsupported ') ||
				line.startsWith('Protein sequence')
		);
	if (explicit) return explicit.replace(/^SystemExit:\s*/, '');

	const tracebackIndex = lines.map((line) => line.startsWith('Traceback ')).lastIndexOf(true);
	if (tracebackIndex >= 0) {
		const exception = lines
			.slice(tracebackIndex + 1)
			.reverse()
			.find((line) => looksLikeException(line));
		if (exception) return exception;
	}

	return (
		[...lines]
			.reverse()
			.find((line) => !isTracebackContext(line) && !looksLikeNonFatalLibraryWarning(line)) ??
		lines.at(-1) ??
		fallback
	);
}

export async function finalizeProteinStructureResult(
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
	const backend = BACKENDS[model.id];
	if (!backend) throw new Error('Protein Structure Prediction requires Boltz-2 or Chai-1.');

	const accelerator = inputs.accelerator === 'gpu' ? 'gpu' : 'cpu';
	const useMsaServer = boolInput(inputs.useMsaServer, true);

	if (!result.ok) {
		if (result.stderr.trim()) onLog(result.stderr.trim());
		throw new Error(
			compactPythonError(
				result.stderr,
				`Protein structure prediction exited with code ${result.exitCode}`
			)
		);
	}
	if (result.stderr.trim()) onLog(result.stderr.trim());

	const parsed = parsePythonJson<{
		structurePath: string;
		summaryPath: string;
		confidencePath: string | null;
		affinityPath: string | null;
		summary: {
			backend: string;
			sequenceCount: number;
			sequenceLengths: number[];
			structurePath: string;
			structureFormat: 'pdb' | 'mmcif';
			confidencePath: string | null;
			affinityPath: string | null;
			confidence: Record<string, JsonValue>;
			affinity: Record<string, JsonValue>;
			binderId: string | null;
			parameters: Record<string, JsonValue>;
			warnings?: string[];
		};
	}>(result.stdout);

	const confidenceScore =
		typeof parsed.summary.confidence.confidence_score === 'number'
			? parsed.summary.confidence.confidence_score
			: typeof parsed.summary.confidence.aggregate_score === 'number'
				? parsed.summary.confidence.aggregate_score
				: 0;
	const affinityProbability =
		typeof parsed.summary.affinity.affinity_probability_binary === 'number'
			? parsed.summary.affinity.affinity_probability_binary
			: 0;

	const provenance: LiatirAIProvenance = {
		toolId: proteinStructureDefinition.id,
		toolLabel: proteinStructureDefinition.label,
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
			ligand: inputs.ligandSmiles?.trim() ? 'SMILES' : inputs.ligandCcd?.trim() ? 'CCD' : 'none',
			sequenceCount: parsed.summary.sequenceCount,
			sequenceLengths: parsed.summary.sequenceLengths
		},
		parameters: parsed.summary.parameters,
		generatedAt: new Date().toISOString()
	};

	const structureExt =
		structureFormat(parsed.structurePath, parsed.summary.structureFormat) === 'pdb' ? 'pdb' : 'cif';
	const maybeFiles = [
		await fileArtifact('Predicted structure', parsed.structurePath, structureExt, 'structureFile'),
		await fileArtifact('Prediction summary', parsed.summaryPath, 'json', 'summaryJson'),
		await fileArtifact('Confidence scores', parsed.confidencePath, 'json', 'confidenceJson'),
		await fileArtifact('Affinity scores', parsed.affinityPath, 'json', 'affinityJson')
	];
	const outputFiles = maybeFiles.filter((file): file is RunOutputFile => !!file);

	return {
		outputFiles,
		output: {
			sections: [
				{
					type: 'stats',
					cols: parsed.summary.affinityPath ? 4 : 3,
					items: [
						{ label: 'Backend', value: parsed.summary.backend },
						{ label: 'Sequences', value: parsed.summary.sequenceCount },
						{ label: 'Confidence', value: confidenceScore.toFixed(3) },
						...(parsed.summary.affinityPath
							? [
									{
										label: 'Binding probability',
										value: `${(affinityProbability * 100).toFixed(1)}%`
									}
								]
							: [])
					]
				},
				{
					type: 'structure-viewer',
					label: basename(parsed.structurePath),
					description:
						'Predicted structure artifact. Full 3D rendering uses the optional 3Dmol.js runtime.',
					path: parsed.structurePath,
					format: structureFormat(parsed.structurePath, parsed.summary.structureFormat),
					style: 'cartoon',
					colorScheme: 'chain',
					height: 460
				},
				...(parsed.summary.warnings?.length
					? [
							{
								type: 'text' as const,
								label: 'Warnings',
								content: parsed.summary.warnings.join('\n')
							}
						]
					: []),
				{
					type: 'table',
					label: 'Confidence',
					headers: ['Metric', 'Value'],
					rows: Object.entries(parsed.summary.confidence)
						.filter(([, value]) => typeof value === 'number' || typeof value === 'string')
						.slice(0, 24)
						.map(([key, value]) => [
							key,
							typeof value === 'number' ? Number(value.toFixed(4)) : String(value)
						])
				},
				...(Object.keys(parsed.summary.affinity).length > 0
					? [
							{
								type: 'table' as const,
								label: 'Affinity',
								headers: ['Metric', 'Value'],
								rows: Object.entries(parsed.summary.affinity)
									.filter(([, value]) => typeof value === 'number' || typeof value === 'string')
									.map(([key, value]) => [
										key,
										typeof value === 'number' ? Number(value.toFixed(4)) : String(value)
									])
							}
						]
					: []),
				{
					type: 'table',
					label: 'Provenance',
					headers: ['Field', 'Value'],
					rows: [
						['AI Model', model.name],
						['Backend', backend],
						['Runtime', `${model.runtime.name} (${model.runtime.kind})`],
						['Input', inputs.inputFile ? basename(inputs.inputFile) : 'inline sequence'],
						['MSA server', useMsaServer ? 'enabled' : 'disabled'],
						['Accelerator', accelerator]
					]
				}
			]
		},
		metrics: {
			confidenceScore,
			affinityProbability,
			sequenceCount: parsed.summary.sequenceCount
		},
		values: {
			structureFile: parsed.structurePath,
			confidenceScore,
			affinityProbability,
			provenance: provenance as unknown as JsonValue
		}
	};
}

export async function runProteinStructureStep(
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
	if (!BACKENDS[model.id] || !modelSupportsStructure(model)) {
		throw new Error('Protein Structure Prediction requires Boltz-2 or Chai-1.');
	}
	if (model.status !== 'installed') throw new Error(`AI Model is not installed: ${model.name}`);
	if (!inputs.inputFile && !inputs.sequence?.trim()) {
		throw new Error('Provide a protein FASTA file or an inline protein sequence.');
	}
	if (inputs.ligandSmiles?.trim() && inputs.ligandCcd?.trim()) {
		throw new Error('Provide either Ligand SMILES or Ligand CCD, not both.');
	}

	const backend = BACKENDS[model.id];
	if (backend === 'chai1') {
		const hardware = await getAIHardwareInfo();
		if (hardware.os !== 'linux' || hardware.cudaAvailable !== true) {
			throw new Error('Chai-1 requires a Linux CUDA host. Use Boltz-2 on this machine.');
		}
		if (inputs.ligandCcd?.trim()) {
			throw new Error(
				'The Chai-1 runner currently supports ligand SMILES, not ligand CCD. Use Boltz-2 for CCD ligands.'
			);
		}
	}

	const outputFormat = inputs.outputFormat === 'pdb' ? 'pdb' : 'mmcif';
	const accelerator = inputs.accelerator === 'gpu' ? 'gpu' : 'cpu';
	const recyclingSteps = numberInput(inputs.recyclingSteps, 3, 1, 20);
	const diffusionSamples = numberInput(inputs.diffusionSamples, 1, 1, 25);
	const useMsaServer = boolInput(inputs.useMsaServer, true);
	const predictAffinity = boolInput(inputs.predictAffinity, true);
	const usePotentials = boolInput(inputs.usePotentials, false);
	const noKernels = boolInput(inputs.noKernels, false);
	const cachePath = cachePathForModel(model);
	const runId = crypto.randomUUID();

	onLog(`ai-tool ${proteinStructureDefinition.id}`);
	onLog(`model ${model.id} (${model.runtime.kind})`);
	onLog(`backend ${backend}`);
	if (accelerator === 'cpu')
		onLog(
			'Boltz-2 CPU inference can take several minutes on short sequences and much longer on large complexes.'
		);
	if (inputs.inputFile) onLog(`input ${basename(inputs.inputFile)}`);
	if (inputs.ligandSmiles?.trim() || inputs.ligandCcd?.trim()) onLog('ligand provided');

	const result = await runAIPython(
		model,
		PROTEIN_STRUCTURE_SCRIPT,
		{
			backend,
			inputFile: inputs.inputFile || '',
			sequence: inputs.sequence || '',
			outputDir,
			runId,
			runtimePath: model.runtimePath ?? model.localPath ?? null,
			modelCacheDir: cachePath,
			ligandSmiles: inputs.ligandSmiles || '',
			ligandCcd: inputs.ligandCcd || '',
			useMsaServer,
			predictAffinity,
			accelerator,
			outputFormat,
			recyclingSteps,
			diffusionSamples,
			usePotentials,
			noKernels
		},
		{
			timeoutSeconds: 24 * 60 * 60,
			jobLabel:
				runContext?.runKind === 'pipeline-step'
					? `${runContext.pipelineName}: ${proteinStructureDefinition.label}`
					: proteinStructureDefinition.label,
			metadata: {
				toolId: proteinStructureDefinition.id,
				backend,
				...(runContext ? aiRunMetadata(runContext) : {})
			},
			signal: runContext?.signal,
			onJobId: runContext?.onJobId
		}
	);

	return await finalizeProteinStructureResult(model, inputs, result, onLog);
}
