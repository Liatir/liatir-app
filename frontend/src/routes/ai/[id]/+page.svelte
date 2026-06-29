<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '@iconify/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import InfoPopup from '$lib/components/ui/InfoPopup.svelte';
	import LabelWithInfo from '$lib/components/ui/LabelWithInfo.svelte';
	import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
	import RunLog from '$lib/components/ui/RunLog.svelte';
	import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
	import { aiModelsStore } from '$lib/stores/aiModels.svelte';
	import { dataFiles } from '$lib/stores/dataFiles.svelte';
	import { analysisRuns, type AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
	import { jobsStore, type JobEntry } from '$lib/stores/jobs.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { modelInstallBlock } from '$lib/ai/model-compatibility';
	import { AI_MODEL_INPUT_HELP, aiModelInfo } from '$lib/ai/model-help';
	import { fmtDuration } from '$lib/utils';
	import { ensureResultsDir } from '$lib/utils/results';
	import type { AIDirectRunContext } from '$lib/ai/direct-run-context';
	import { getAIHardwareInfo, type AIHardwareInfo } from '$lib/ai/runtime';
	import {
		BOLTZ2_MODEL_ID,
		CELLTYPIST_MODEL_ID,
		CHAI1_MODEL_ID,
		ESM2_8M_ID,
		MOCK_AI_MODEL_ID,
		NUCLEOTIDE_TRANSFORMER_50M_ID
	} from '$lib/ai/model-registry';
	import {
		celltypistAnnotateDefinition,
		runCelltypistAnnotateStep
	} from '$lib/tools/ai/celltypist-annotate';
	import {
		sequenceEmbeddingDefinition,
		runSequenceEmbeddingStep
	} from '$lib/tools/ai/sequence-embedding';
	import { mockAIInferenceDefinition, runMockAIInferenceStep } from '$lib/tools/ai/mock-inference';
	import {
		proteinStructureDefinition,
		runProteinStructureStep
	} from '$lib/tools/ai/protein-structure';
	import type { ToolOutput } from '$lib/types/tool-output';
	import type { RunOutputFile } from '$lib/types/pipeline';

	type RunMode = 'celltypist' | 'sequence' | 'protein-structure' | 'mock' | 'unsupported';
	type MoleculeType = 'dna' | 'rna' | 'protein';
	type Accelerator = 'cpu' | 'gpu';
	type ProteinOutputFormat = 'mmcif' | 'pdb';

	const acceleratorOptions = [
		{ value: 'cpu', label: 'CPU' },
		{ value: 'gpu', label: 'GPU' }
	];
	const proteinOutputFormatOptions = [
		{ value: 'mmcif', label: 'mmCIF' },
		{ value: 'pdb', label: 'PDB' }
	];

	const modelId = $derived(page.params.id ?? '');
	const model = $derived(aiModelsStore.byId(modelId));
	const mode = $derived(runMode(modelId));
	const definition = $derived(
		mode === 'celltypist'
			? celltypistAnnotateDefinition
			: mode === 'sequence'
				? sequenceEmbeddingDefinition
				: mode === 'protein-structure'
					? proteinStructureDefinition
					: mode === 'mock'
						? mockAIInferenceDefinition
						: null
	);

	let running = $state(false);
	let startedAt = $state<number | null>(null);
	let now = $state(Date.now());
	let logLines = $state<string[]>([]);
	let selectedRunId = $state<string | null>(null);
	let loadedOutput = $state<ToolOutput | null>(null);
	let loadingOutput = $state(false);
	let hardware = $state<AIHardwareInfo | null>(null);
	let jobRefreshInterval: ReturnType<typeof setInterval> | null = null;

	let inputFile = $state('');
	let sequence = $state('');
	let moleculeType = $state<MoleculeType>('dna');
	let maxLength = $state(1024);
	let celltypistModel = $state('Immune_All_Low.pkl');
	let majorityVoting = $state(false);
	let ligandSmiles = $state('');
	let ligandCcd = $state('');
	let useMsaServer = $state(true);
	let predictAffinity = $state(true);
	let accelerator = $state<Accelerator>('cpu');
	let outputFormat = $state<ProteinOutputFormat>('mmcif');
	let recyclingSteps = $state(3);
	let diffusionSamples = $state(1);
	let usePotentials = $state(false);
	let noKernels = $state(false);
	let prompt = $state('Summarize the selected model run.');
	let context = $state('');

	const h5adFiles = $derived(dataFiles.byExt('h5ad'));
	const sequenceFiles = $derived(dataFiles.byExt('fasta', 'fa', 'faa', 'fna', 'txt'));
	const modelRuns = $derived(
		definition
			? analysisRuns.byTool(definition.id).filter((run) => run.params?.modelId === modelId)
			: []
	);
	const moleculeOptions = $derived(
		modelId === ESM2_8M_ID
			? [{ value: 'protein', label: 'Protein' }]
			: [
					{ value: 'dna', label: 'DNA' },
					{ value: 'rna', label: 'RNA' }
				]
	);
	const selectedRun = $derived(modelRuns.find((run) => run.id === selectedRunId) ?? null);
	const selectedRunOutputFiles = $derived(selectedRun?.outputFiles ?? []);
	const activeModelJobs = $derived(
		jobsStore.jobs.filter(
			(job) =>
				job.status.type === 'running' &&
				job.kind === 'ai-python' &&
				jobMetadataString(job, 'modelId') === modelId
		)
	);
	const activeModelJob = $derived(activeModelJobs[activeModelJobs.length - 1] ?? null);
	const modelRunActive = $derived(running || !!activeModelJob);
	const displayError = $derived<string | null>(
		selectedRun?.status === 'error' ? (selectedRun.error ?? 'Unknown error') : null
	);
	const installBlock = $derived(model ? modelInstallBlock(model, hardware) : null);
	const formDisabled = $derived(modelRunActive);
	const runStartedAt = $derived(startedAt ?? activeModelJob?.startedAtMs ?? null);
	const canRun = $derived(
		!!model &&
			model.status === 'installed' &&
			!!definition &&
			!modelRunActive &&
			(mode === 'celltypist'
				? !!inputFile
				: mode === 'sequence'
					? !!inputFile || !!sequence.trim()
					: mode === 'protein-structure'
						? !!inputFile || !!sequence.trim()
						: mode === 'mock'
							? !!prompt.trim()
							: false)
	);

	$effect(() => {
		if (!modelRunActive) return;
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	$effect(() => {
		if (modelId === ESM2_8M_ID && moleculeType !== 'protein') moleculeType = 'protein';
		if (modelId === NUCLEOTIDE_TRANSFORMER_50M_ID && moleculeType === 'protein')
			moleculeType = 'dna';
	});

	$effect(() => {
		const id = selectedRunId;
		if (!id) {
			loadedOutput = null;
			return;
		}
		loadingOutput = true;
		analysisRuns.loadOutput(id).then((output) => {
			loadedOutput = output;
			loadingOutput = false;
		});
	});

	onMount(() => {
		void aiModelsStore.init();
		void dataFiles.init();
		void jobsStore.refresh();
		void getAIHardwareInfo()
			.then((info) => (hardware = info))
			.catch(() => (hardware = null));
		void analysisRuns.init();
		jobRefreshInterval = setInterval(() => {
			if (modelRunActive || jobsStore.runningCount > 0) void jobsStore.refresh();
		}, 2000);
		return () => {
			if (jobRefreshInterval) clearInterval(jobRefreshInterval);
		};
	});

	function runMode(id: string): RunMode {
		if (id === CELLTYPIST_MODEL_ID) return 'celltypist';
		if (id === NUCLEOTIDE_TRANSFORMER_50M_ID || id === ESM2_8M_ID) return 'sequence';
		if (id === BOLTZ2_MODEL_ID || id === CHAI1_MODEL_ID) return 'protein-structure';
		if (id === MOCK_AI_MODEL_ID) return 'mock';
		return 'unsupported';
	}

	function basename(path: string): string {
		return path.split(/[\\/]/).pop() ?? path;
	}

	function fmtDate(ms: number) {
		return new Date(ms).toLocaleDateString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function jobMetadataString(job: JobEntry, key: string): string | null {
		const metadata = job.metadata;
		if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
		const value = metadata[key];
		return typeof value === 'string' ? value : null;
	}

	function inputSize(path: string): number | undefined {
		return dataFiles.files.find((file) => file.path === path)?.size;
	}

	async function runModel() {
		if (!model || !definition || !canRun) return;

		running = true;
		selectedRunId = null;
		loadedOutput = null;
		startedAt = Date.now();
		logLines = [];

		const runId = crypto.randomUUID();
		const t0 = startedAt;
		const logs: string[] = [];
		const onLog = (line: string) => {
			if (!line.trim()) return;
			logs.push(line);
			logLines = [...logs];
		};

		let inputs: Record<string, string>;
		let label = model.name;
		const inputPaths: string[] = [];

		if (mode === 'celltypist') {
			inputs = {
				modelId: model.id,
				inputFile,
				celltypistModel,
				majorityVoting: String(majorityVoting)
			};
			label = basename(inputFile);
			inputPaths.push(inputFile);
		} else if (mode === 'sequence') {
			inputs = {
				modelId: model.id,
				moleculeType,
				inputFile,
				sequence,
				maxLength: String(maxLength)
			};
			label = inputFile ? basename(inputFile) : `${moleculeType.toUpperCase()} sequence`;
			if (inputFile) inputPaths.push(inputFile);
		} else if (mode === 'protein-structure') {
			inputs = {
				modelId: model.id,
				inputFile,
				sequence,
				ligandSmiles,
				ligandCcd,
				useMsaServer: String(useMsaServer),
				predictAffinity: String(predictAffinity),
				accelerator,
				outputFormat,
				recyclingSteps: String(recyclingSteps),
				diffusionSamples: String(diffusionSamples),
				usePotentials: String(usePotentials),
				noKernels: String(noKernels)
			};
			label = inputFile ? basename(inputFile) : 'Protein structure';
			if (inputFile) inputPaths.push(inputFile);
		} else {
			inputs = {
				modelId: model.id,
				prompt,
				context
			};
			label = 'Mock inference';
		}

		const inputSizes =
			inputPaths.length > 0 ? inputPaths.map((path) => inputSize(path) ?? 0) : undefined;

		try {
			const { absDir } = await ensureResultsDir(definition.label);
			const directRunContext: AIDirectRunContext | undefined =
				mode === 'celltypist' || mode === 'sequence' || mode === 'protein-structure'
					? {
							runKind: 'ai-model-direct',
							analysisRunId: runId,
							toolId: definition.id,
							mode,
							label,
							inputPaths,
							inputSizes,
							params: inputs,
							startedAt: t0,
							outputDir: absDir
						}
					: undefined;
			const result =
				mode === 'celltypist'
					? await runCelltypistAnnotateStep(inputs, absDir, onLog, directRunContext)
					: mode === 'sequence'
						? await runSequenceEmbeddingStep(inputs, absDir, onLog, directRunContext)
						: mode === 'protein-structure'
							? await runProteinStructureStep(inputs, absDir, onLog, directRunContext)
							: await runMockAIInferenceStep(inputs, absDir, onLog);

			const endedAt = Date.now();
			onLog(`Completed in ${fmtDuration(t0, endedAt)}`);
			await analysisRuns.add({
				id: runId,
				tool: definition.id,
				label,
				inputs: inputPaths,
				inputSizes,
				outputFiles: result.outputFiles as RunOutputFile[],
				params: inputs,
				status: 'done',
				startedAt: t0,
				endedAt,
				durationMs: endedAt - t0,
				output: result.output ?? null,
				error: null,
				log: [...logs]
			});
			toast.success('AI Model run complete');
		} catch (error) {
			const endedAt = Date.now();
			const message = error instanceof Error ? error.message : String(error);
			onLog(`Error: ${message}`);
			await analysisRuns.add({
				id: runId,
				tool: definition.id,
				label,
				inputs: inputPaths,
				inputSizes,
				params: inputs,
				status: 'error',
				startedAt: t0,
				endedAt,
				durationMs: endedAt - t0,
				output: null,
				error: message,
				log: [...logs]
			});
			toast.error(message);
		} finally {
			running = false;
			startedAt = null;
			selectedRunId = runId;
		}
	}

	async function deleteRun(run: AnalysisRunMeta) {
		if (running) return;
		const ok = await confirm({
			title: 'Delete run',
			message: `Delete the ${definition?.label ?? 'AI Model'} run for "${run.label}"?`,
			confirmLabel: 'Delete'
		});
		if (!ok) return;
		if (selectedRunId === run.id)
			selectedRunId = modelRuns.find((item) => item.id !== run.id)?.id ?? null;
		await analysisRuns.remove(run.id);
	}
</script>

<div class="flex h-full overflow-hidden">
	<div class="w-56 shrink-0 border-r border-border bg-surface flex flex-col">
		<div class="flex items-center justify-between px-3 py-3 border-b border-border">
			<span class="text-xs font-medium text-zinc-600">Run history</span>
			{#if modelRuns.length > 0}
				<span class="text-[10px] text-zinc-400">{modelRuns.length}</span>
			{/if}
		</div>

		<div class="flex-1 overflow-y-auto py-1">
			{#if modelRuns.length === 0}
				<p class="text-xs text-zinc-400 text-center py-8 px-3 leading-relaxed">
					No runs yet.<br />Results will appear here.
				</p>
			{:else}
				{#each modelRuns as run (run.id)}
					<div
						class="group relative flex items-start transition-colors {selectedRunId === run.id
							? 'bg-brand/8'
							: 'hover:bg-surface-2'}"
					>
						<button
							onclick={() => (selectedRunId = run.id)}
							class="flex-1 text-left px-3 py-2.5 min-w-0"
						>
							<div class="flex items-center gap-1.5 mb-0.5">
								<span
									class="h-1.5 w-1.5 rounded-full shrink-0 {run.status === 'done'
										? 'bg-emerald-500'
										: 'bg-red-500'}"
								></span>
								<p
									class="text-xs font-medium truncate {selectedRunId === run.id
										? 'text-brand'
										: 'text-zinc-700'}"
								>
									{run.label}
								</p>
							</div>
							<p class="text-[10px] text-zinc-400 pl-3">
								{fmtDate(run.startedAt)} · {fmtDuration(run.startedAt, run.endedAt)}
							</p>
						</button>
						<button
							onclick={() => deleteRun(run)}
							disabled={running}
							aria-label="Delete run"
							class="opacity-0 group-hover:opacity-100 p-1.5 mt-2 mr-1.5 shrink-0 text-zinc-400 hover:text-red-500 transition-all rounded disabled:pointer-events-none disabled:opacity-20"
						>
							<Icon icon="lucide:x" width="11" height="11" />
						</button>
					</div>
				{/each}
			{/if}
		</div>
	</div>

	<div class="flex-1 flex flex-col overflow-hidden">
		<PageHeader
			title={model?.name ?? 'AI Model'}
			info={model ? aiModelInfo(model) : undefined}
			description={definition?.description ?? 'Run a local AI Model'}
		>
			{#snippet actions()}
				<Button variant="ghost" size="sm" onclick={() => goto('/ai')}>
					<Icon icon="lucide:arrow-left" width="14" height="14" />
					Back
				</Button>
			{/snippet}
		</PageHeader>

		<div class="flex-1 overflow-y-auto p-6 space-y-5">
			{#if !model}
				<Card class="p-5">
					<p class="text-sm font-semibold text-zinc-800">AI Model not found</p>
					<p class="mt-1 text-xs text-zinc-500">Open AI Models and select an available model.</p>
				</Card>
			{:else if model.status !== 'installed'}
				<Card class="p-5">
					{#if installBlock}
						<p class="text-sm font-semibold text-zinc-800">Incompatible host</p>
						<p class="mt-1 text-xs leading-relaxed text-amber-700">{installBlock.reason}</p>
					{:else}
						<p class="text-sm font-semibold text-zinc-800">Install required</p>
						<p class="mt-1 text-xs text-zinc-500">
							Install this AI Model before running it directly.
						</p>
					{/if}
				</Card>
			{:else if mode === 'unsupported'}
				<Card class="p-5">
					<p class="text-sm font-semibold text-zinc-800">No direct runner available</p>
					<p class="mt-1 text-xs text-zinc-500">
						This AI Model can be used by compatible AI Tools once a direct runner is implemented.
					</p>
				</Card>
			{:else}
				<Card class="p-5 space-y-4">
					<div>
						<div class="flex items-center gap-1">
							<p class="text-sm font-semibold text-zinc-800">Input</p>
							<InfoPopup text={AI_MODEL_INPUT_HELP.runInput} />
						</div>
						<p class="mt-1 text-xs text-zinc-500">
							{model.runtime.name} · {model.modalities.join(', ')}
						</p>
					</div>

					<fieldset disabled={formDisabled} class="space-y-4 disabled:opacity-70">
						{#if mode === 'celltypist'}
							<FilePickerPopup
								files={h5adFiles}
								value={inputFile}
								label="AnnData file"
								info={AI_MODEL_INPUT_HELP.annDataFile}
								emptyText="No h5ad files in Data yet."
								disabled={formDisabled}
								onchange={(path) => (inputFile = path)}
							/>
							<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
								<div>
									<LabelWithInfo
										targetId="celltypist-model"
										text="CellTypist model"
										info={AI_MODEL_INPUT_HELP.celltypistModel}
									/>
									<input
										id="celltypist-model"
										type="text"
										bind:value={celltypistModel}
										disabled={formDisabled}
										class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors"
									/>
								</div>
								<label class="flex items-end gap-2 text-xs text-zinc-600 pb-2">
									<input type="checkbox" bind:checked={majorityVoting} disabled={formDisabled} />
									<span>Majority voting</span>
									<InfoPopup text={AI_MODEL_INPUT_HELP.majorityVoting} />
								</label>
							</div>
						{:else if mode === 'sequence'}
							<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
								<div>
									<LabelWithInfo
										targetId="molecule-type"
										text="Molecule"
										info={AI_MODEL_INPUT_HELP.molecule}
									/>
									<Select
										id="molecule-type"
										value={moleculeType}
										options={moleculeOptions}
										disabled={formDisabled}
										onchange={(value) => (moleculeType = value as MoleculeType)}
									/>
								</div>
								<div>
									<LabelWithInfo
										targetId="max-length"
										text="Max tokens"
										info={AI_MODEL_INPUT_HELP.maxTokens}
									/>
									<input
										id="max-length"
										type="number"
										min="16"
										max="4096"
										step="16"
										bind:value={maxLength}
										disabled={formDisabled}
										class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors"
									/>
								</div>
							</div>
							<FilePickerPopup
								files={sequenceFiles}
								value={inputFile}
								label="FASTA file"
								info={AI_MODEL_INPUT_HELP.fastaFile}
								emptyText="No FASTA files in Data yet."
								disabled={formDisabled}
								onchange={(path) => (inputFile = path)}
							/>
							<div>
								<LabelWithInfo
									targetId="inline-sequence"
									text="Inline sequence"
									info={AI_MODEL_INPUT_HELP.inlineSequence}
								/>
								<textarea
									id="inline-sequence"
									bind:value={sequence}
									rows="5"
									disabled={formDisabled}
									placeholder="Paste a DNA, RNA, or protein sequence..."
									class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-brand transition-colors font-mono"
								></textarea>
							</div>
						{:else if mode === 'protein-structure'}
							<FilePickerPopup
								files={sequenceFiles}
								value={inputFile}
								label="Protein FASTA"
								info={AI_MODEL_INPUT_HELP.proteinFasta}
								emptyText="No protein FASTA files in Data yet."
								disabled={formDisabled}
								onchange={(path) => (inputFile = path)}
							/>
							<div>
								<LabelWithInfo
									targetId="protein-sequence"
									text="Inline protein sequence"
									info={AI_MODEL_INPUT_HELP.inlineProteinSequence}
								/>
								<textarea
									id="protein-sequence"
									bind:value={sequence}
									rows="5"
									disabled={formDisabled}
									placeholder="Paste a protein sequence..."
									class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-brand transition-colors font-mono"
								></textarea>
							</div>
							<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
								<div>
									<LabelWithInfo
										targetId="ligand-smiles"
										text="Ligand SMILES"
										info={AI_MODEL_INPUT_HELP.ligandSmiles}
									/>
									<input
										id="ligand-smiles"
										type="text"
										bind:value={ligandSmiles}
										disabled={formDisabled}
										class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors font-mono"
									/>
								</div>
								<div>
									<LabelWithInfo
										targetId="ligand-ccd"
										text="Ligand CCD"
										info={AI_MODEL_INPUT_HELP.ligandCcd}
									/>
									<input
										id="ligand-ccd"
										type="text"
										bind:value={ligandCcd}
										disabled={formDisabled}
										class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors font-mono"
									/>
								</div>
							</div>
							<div class="grid grid-cols-1 md:grid-cols-4 gap-3">
								<div>
									<LabelWithInfo
										targetId="accelerator"
										text="Accelerator"
										info={AI_MODEL_INPUT_HELP.accelerator}
									/>
									<Select
										id="accelerator"
										value={accelerator}
										options={acceleratorOptions}
										disabled={formDisabled}
										onchange={(value) => (accelerator = value as Accelerator)}
									/>
								</div>
								<div>
									<LabelWithInfo
										targetId="output-format"
										text="Output"
										info={AI_MODEL_INPUT_HELP.outputFormat}
									/>
									<Select
										id="output-format"
										value={outputFormat}
										options={proteinOutputFormatOptions}
										disabled={formDisabled}
										onchange={(value) => (outputFormat = value as ProteinOutputFormat)}
									/>
								</div>
								<div>
									<LabelWithInfo
										targetId="recycling-steps"
										text="Recycling"
										info={AI_MODEL_INPUT_HELP.recyclingSteps}
									/>
									<input
										id="recycling-steps"
										type="number"
										min="1"
										max="20"
										bind:value={recyclingSteps}
										disabled={formDisabled}
										class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors"
									/>
								</div>
								<div>
									<LabelWithInfo
										targetId="diffusion-samples"
										text="Samples"
										info={AI_MODEL_INPUT_HELP.diffusionSamples}
									/>
									<input
										id="diffusion-samples"
										type="number"
										min="1"
										max="25"
										bind:value={diffusionSamples}
										disabled={formDisabled}
										class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors"
									/>
								</div>
							</div>
							<div class="flex flex-wrap gap-4">
								<label class="flex items-center gap-2 text-xs text-zinc-600">
									<input type="checkbox" bind:checked={useMsaServer} disabled={formDisabled} />
									<span>Use MSA server</span>
									<InfoPopup text={AI_MODEL_INPUT_HELP.useMsaServer} />
								</label>
								<label class="flex items-center gap-2 text-xs text-zinc-600">
									<input type="checkbox" bind:checked={predictAffinity} disabled={formDisabled} />
									<span>Predict affinity</span>
									<InfoPopup text={AI_MODEL_INPUT_HELP.predictAffinity} />
								</label>
								<label class="flex items-center gap-2 text-xs text-zinc-600">
									<input type="checkbox" bind:checked={usePotentials} disabled={formDisabled} />
									<span>Use potentials</span>
									<InfoPopup text={AI_MODEL_INPUT_HELP.usePotentials} />
								</label>
								<label class="flex items-center gap-2 text-xs text-zinc-600">
									<input type="checkbox" bind:checked={noKernels} disabled={formDisabled} />
									<span>Disable CUDA kernels</span>
									<InfoPopup text={AI_MODEL_INPUT_HELP.noKernels} />
								</label>
							</div>
						{:else if mode === 'mock'}
							<div>
								<LabelWithInfo targetId="prompt" text="Prompt" info={AI_MODEL_INPUT_HELP.prompt} />
								<textarea
									id="prompt"
									bind:value={prompt}
									rows="3"
									disabled={formDisabled}
									class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors"
								></textarea>
							</div>
							<div>
								<LabelWithInfo
									targetId="context"
									text="Context"
									info={AI_MODEL_INPUT_HELP.context}
								/>
								<textarea
									id="context"
									bind:value={context}
									rows="4"
									disabled={formDisabled}
									class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand transition-colors"
								></textarea>
							</div>
						{/if}
					</fieldset>

					<div class="flex items-center gap-3 pt-1">
						<Button variant="primary" disabled={!canRun} loading={running} onclick={runModel}>
							Run
						</Button>
						{#if modelRunActive && runStartedAt}
							<span class="text-xs text-zinc-400">Elapsed: {fmtDuration(runStartedAt, now)}</span>
						{/if}
						{#if activeModelJob && !running}
							<Button variant="ghost" size="sm" onclick={() => goto('/jobs')}>
								<Icon icon="lucide:radio" width="13" height="13" />
								Open Jobs
							</Button>
						{/if}
					</div>
				</Card>
			{/if}

			{#if running && logLines.length > 0}
				<Card class="p-4">
					<p class="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
						Current run log
					</p>
					<pre
						class="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-zinc-600 font-mono">{logLines.join(
							'\n'
						)}</pre>
				</Card>
			{:else if activeModelJob && !running}
				<Card class="p-4">
					<div class="flex items-center justify-between gap-3">
						<div>
							<p class="mb-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
								Active AI Model job
							</p>
							<p class="text-xs text-zinc-600">
								This model is still running in Jobs. Inputs are locked until the job exits.
							</p>
						</div>
						<Button variant="ghost" size="sm" onclick={() => goto('/jobs')}>Open Jobs</Button>
					</div>
				</Card>
			{/if}

			{#if displayError}
				<div
					class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono"
					data-selectable
				>
					{displayError}
				</div>
				<RunLog runId={selectedRunId} />
			{:else if loadingOutput}
				<div class="flex justify-center py-12">
					<Icon icon="svg-spinners:ring-resize" width="22" height="22" class="text-zinc-400" />
				</div>
			{:else if loadedOutput}
				<div>
					<p class="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
						Last run result
					</p>
					<div class="flex items-center justify-between mb-3">
						<h2 class="text-xs font-medium text-zinc-700">{selectedRun?.label ?? 'Results'}</h2>
						{#if selectedRun}
							<span class="text-xs text-zinc-400">
								{fmtDate(selectedRun.startedAt)} · {fmtDuration(
									selectedRun.startedAt,
									selectedRun.endedAt
								)}
							</span>
						{/if}
					</div>
					<ToolResultView output={loadedOutput} outputFiles={selectedRunOutputFiles} />
					<RunLog runId={selectedRunId} />
				</div>
			{/if}
		</div>
	</div>
</div>
