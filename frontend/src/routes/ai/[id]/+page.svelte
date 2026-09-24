<!-- Direct-run page for the three single-cell AI Models distributed as Runtime Boxes. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '@iconify/svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import PageContent from '$lib/components/layout/PageContent.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import InfoPopup from '$lib/components/ui/InfoPopup.svelte';
	import LabelWithInfo from '$lib/components/ui/LabelWithInfo.svelte';
	import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
	import RunRecord from '$lib/components/ui/RunRecord.svelte';
	import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
	import { aiModelsStore } from '$lib/stores/aiModels.svelte';
	import { dataFiles } from '$lib/stores/dataFiles.svelte';
	import { analysisRuns, type AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
	import { jobsStore, type JobEntry } from '$lib/stores/jobs.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { modelInstallBlock } from '$lib/ai/model-compatibility';
	import { aiModelLiatirDocsUrl, aiModelOfficialUrl } from '$lib/ai/model-docs';
	import { AI_MODEL_INPUT_HELP, aiModelInfo } from '$lib/ai/model-help';
	import { fmtDuration, openLinkInBrowser, sanitizeLocalPathsForDisplay } from '$lib/utils';
	import { ensureRunOutputDir } from '$lib/execution/run-storage';
	import type { AIDirectRunContext } from '$lib/ai/direct-run-context';
	import { getAIHardwareInfo, type AIHardwareInfo } from '$lib/ai/runtime';
	import {
		GENEFORMER_V1_10M_MODEL_ID,
		SCGPT_WHOLE_HUMAN_MODEL_ID
	} from '$lib/ai/model-registry';
	import {
		singleCellEmbeddingDefinition,
		singleCellAnnDataRequirement,
		runSingleCellEmbeddingStep,
		uceSpeciesOptions
	} from '$lib/tools/ai/single-cell-embedding';
	import type { ToolOutput } from '$lib/types/tool-output';
	import type { RunOutputFile } from '$lib/types/pipeline';
	import { HEADER_HEIGHT } from '$lib/_constants';
	import { createLiatirRootExecutionIdentity } from '@liatir/core';
	import { workspaceStore } from '$lib/stores/workspace.svelte';
	import { executionRuns } from '$lib/stores/executionRuns.svelte';
	import { finalizeExecutionResult } from '$lib/execution/finalization';
	import { artifactCompatibility } from '$lib/scientific-artifacts';
	import MhcFlurryModelPage from '$lib/components/ai/MhcFlurryModelPage.svelte';
	import { MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID } from '@liatir/core';

	const modelId = $derived(page.params.id ?? '');
	const model = $derived(aiModelsStore.byId(modelId));
	const humanOnlyModel = $derived(
		modelId === GENEFORMER_V1_10M_MODEL_ID || modelId === SCGPT_WHOLE_HUMAN_MODEL_ID
	);
	const batchSizeMax = $derived(modelId === SCGPT_WHOLE_HUMAN_MODEL_ID ? 64 : 256);
	const inputHelp = $derived(
		modelId === GENEFORMER_V1_10M_MODEL_ID
			? AI_MODEL_INPUT_HELP.geneformerAnnDataFile
			: modelId === SCGPT_WHOLE_HUMAN_MODEL_ID
				? AI_MODEL_INPUT_HELP.scgptAnnDataFile
				: AI_MODEL_INPUT_HELP.uceAnnDataFile
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
	let species = $state('human');
	let batchSize = $state(25);
	let maxCsvRows = $state(500);
	let activeExecutionRunId = $state<string | null>(null);

	const h5adFiles = $derived(dataFiles.byExt('h5ad'));
	const modelRuns = $derived(
		analysisRuns
			.byTool(singleCellEmbeddingDefinition.id)
			.filter((run) => run.params?.modelId === modelId)
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
	const selectedInputArtifact = $derived(
		dataFiles.files.find((file) => file.path === inputFile)?.scientific
	);
	const inputCompatibility = $derived(
		inputFile
			? artifactCompatibility(
				selectedInputArtifact,
				singleCellAnnDataRequirement(modelId, humanOnlyModel ? 'human' : species)
			)
			: null
	);
	const inputCompatibilityDiagnostics = $derived(
		inputCompatibility?.diagnostics
			.filter((item) => inputCompatibility.status === 'incompatible' ? item.severity === 'error' : item.severity === 'warning')
			?? []
	);
	// One line, not all of them joined into a paragraph. An uninspected file produces three warnings
	// that each restate "this has not been inspected" and twice tell the user to inspect it, which
	// read as a wall of amber text with no single action in it. The rest stay one click away.
	const inputCompatibilityMessage = $derived(
		inputCompatibilityDiagnostics[0]
			? `${inputCompatibilityDiagnostics[0].message}${inputCompatibilityDiagnostics[0].action ? ` ${inputCompatibilityDiagnostics[0].action}` : ''}`
			: ''
	);
	const displayError = $derived<string | null>(
		selectedRun?.status === 'error' ? (selectedRun.error ?? 'Unknown error') : null
	);
	const installBlock = $derived(model ? modelInstallBlock(model, hardware) : null);
	const canRun = $derived(
		!!model && model.status === 'installed' && !!inputFile &&
		inputCompatibility?.status !== 'incompatible' && !modelRunActive
	);
	const runStartedAt = $derived(startedAt ?? activeModelJob?.startedAtMs ?? null);

	$effect(() => {
		if (!modelRunActive) return;
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
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
		void analysisRuns.init();
		void getAIHardwareInfo()
			.then((info) => (hardware = info))
			.catch(() => (hardware = null));
		jobRefreshInterval = setInterval(() => {
			if (modelRunActive || jobsStore.runningCount > 0) void jobsStore.refresh();
		}, 2000);
		return () => {
			if (jobRefreshInterval) clearInterval(jobRefreshInterval);
		};
	});

	function basename(path: string): string {
		return path.split(/[\\/]/).pop() ?? path;
	}

	function fmtDate(ms: number): string {
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
		const workspaceId = workspaceStore.activeId;
		if (!model || !canRun || !workspaceId) return;
		running = true;
		selectedRunId = null;
		loadedOutput = null;
		startedAt = Date.now();
		logLines = [];

		const runId = crypto.randomUUID();
		activeExecutionRunId = runId;
		const t0 = startedAt;
		const logs: string[] = [];
		const onLog = (line: string) => {
			if (!line.trim()) return;
			logs.push(line);
			logLines = [...logs];
			void executionRuns.appendLog(runId, line, { stream: 'system' }).catch(() => {});
		};
		const inputs = {
			modelId: model.id,
			inputFile,
			species: humanOnlyModel ? 'human' : species,
			batchSize: String(Math.min(batchSize, batchSizeMax)),
			maxCsvRows: String(maxCsvRows)
		};
		const label = basename(inputFile);
		const inputSizes = [inputSize(inputFile) ?? 0];
		const execution = createLiatirRootExecutionIdentity({
			runId,
			runKind: 'ai-model',
			workspaceId,
			entityId: model.id
		});

		try {
			await executionRuns.begin({
				identity: execution,
				label,
				resultPolicy: 'own',
				resultId: runId,
				inputs: [inputFile],
				params: inputs
			});
			const absDir = await ensureRunOutputDir(runId);
			const context: AIDirectRunContext = {
				runKind: 'ai-model-direct',
				execution,
				analysisRunId: runId,
				toolId: singleCellEmbeddingDefinition.id,
				mode: 'single-cell-embedding',
				label,
				inputPaths: [inputFile],
				inputSizes,
				params: inputs,
				startedAt: t0,
				outputDir: absDir,
				signal: executionRuns.signal(runId),
				onJobId: (jobId) => {
					void executionRuns.attachJob(runId, jobId).catch(() => {});
					// Publish the Job to the shared list now: a Jobs page opened right after Run has
					// already loaded an empty list and only polls while it holds a running job.
					void jobsStore.refresh();
				}
			};
			const result = await runSingleCellEmbeddingStep(inputs, absDir, onLog, context);
			const endedAt = Date.now();
			onLog(`Completed in ${fmtDuration(t0, endedAt)}`);
			await finalizeExecutionResult(runId, 'done', {
				id: runId,
				tool: singleCellEmbeddingDefinition.id,
				label,
				inputs: [inputFile],
				inputSizes,
				outputFiles: result.outputFiles as RunOutputFile[],
				sideEffects: result.sideEffects as RunOutputFile[],
				params: inputs,
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
			const cancelled = executionRuns.byId(runId)?.status === 'cancelling' ||
				(error instanceof DOMException && error.name === 'AbortError');
			if (executionRuns.byId(runId)) {
				await finalizeExecutionResult(runId, cancelled ? 'cancelled' : 'error', {
					id: runId,
					tool: singleCellEmbeddingDefinition.id,
					label,
					inputs: [inputFile],
					inputSizes,
					// Failed before the model reported what it wrote.
					sideEffects: [],
					params: inputs,
					startedAt: t0,
					endedAt,
					durationMs: endedAt - t0,
					output: null,
					error: cancelled ? 'AI Model run was cancelled.' : message,
					log: [...logs]
				}).catch(() => {});
			}
			toast.error(message);
		} finally {
			running = false;
			activeExecutionRunId = null;
			startedAt = null;
			selectedRunId = runId;
		}
	}

	async function cancelModelRun() {
		if (!activeExecutionRunId) return;
		await executionRuns.cancel(activeExecutionRunId);
	}

	async function deleteRun(run: AnalysisRunMeta) {
		if (running) return;
		const ok = await confirm({
			title: 'Delete run',
			message: `Delete the Single-cell Embedding run for "${run.label}"?`,
			confirmLabel: 'Delete'
		});
		if (!ok) return;
		if (selectedRunId === run.id) {
			selectedRunId = modelRuns.find((item) => item.id !== run.id)?.id ?? null;
		}
		await analysisRuns.remove(run.id);
	}

	async function openCurrentModelDocs() {
		if (!model) return;
		const url = aiModelLiatirDocsUrl(model);
		if (url) await openLinkInBrowser(url);
	}

	async function openCurrentOfficialModelPage() {
		if (!model) return;
		const url = aiModelOfficialUrl(model);
		if (url) await openLinkInBrowser(url);
	}
</script>

{#if modelId === MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID}
	<MhcFlurryModelPage {modelId} />
{:else}
<div class="flex h-full overflow-hidden">
	<div class="w-56 shrink-0 border-r border-border flex flex-col">
		<div class="flex items-end justify-between px-3 py-3 border-b border-border bg-surface" style="height: {HEADER_HEIGHT}px;">
			<span class="text-sm font-medium text-text-secondary">Run history</span>
			{#if modelRuns.length > 0}<span class="text-xs text-text-subtle">{modelRuns.length}</span>{/if}
		</div>
		<div class="flex-1 overflow-y-auto py-1 bg-surface">
			{#if modelRuns.length === 0}
				<p class="text-xs text-text-subtle text-center py-8 px-3 leading-relaxed">No runs yet.<br />Results will appear here.</p>
			{:else}
				{#each modelRuns as run (run.id)}
					<div class="group relative flex items-start transition-colors {selectedRunId === run.id ? 'bg-brand/8' : 'hover:bg-surface-2'}">
						<button onclick={() => (selectedRunId = run.id)} class="flex-1 text-left px-3 py-2.5 min-w-0">
							<div class="flex items-center gap-1.5 mb-0.5">
								<span class="h-1.5 w-1.5 rounded-full shrink-0 {run.status === 'done' ? 'bg-emerald-500' : 'bg-red-500'}"></span>
								<p class="text-xs font-medium truncate {selectedRunId === run.id ? 'text-brand' : 'text-text-secondary'}">{run.label}</p>
							</div>
							<p class="text-[10px] text-text-subtle pl-3">{fmtDate(run.startedAt)} · {fmtDuration(run.startedAt, run.endedAt)}</p>
						</button>
						<button onclick={() => deleteRun(run)} disabled={running} aria-label="Delete run" class="opacity-0 group-hover:opacity-100 p-1.5 mt-2 mr-1.5 shrink-0 text-text-subtle hover:text-red-500 transition-all rounded disabled:pointer-events-none disabled:opacity-20">
							<Icon icon="lucide:x" width="11" height="11" />
						</button>
					</div>
				{/each}
			{/if}
		</div>
	</div>

	<div class="flex-1 flex flex-col overflow-hidden">
		<PageHeader title={model?.name ?? 'AI Model'} info={model ? aiModelInfo(model) : undefined} description={singleCellEmbeddingDefinition.description}>
			{#snippet actions()}
				{#if model && aiModelLiatirDocsUrl(model)}
					<Button variant="secondary" size="sm" onclick={openCurrentModelDocs}><Icon icon="lucide:book-open" width="14" height="14" />Docs</Button>
				{/if}
				{#if model && aiModelOfficialUrl(model)}
					<Button variant="secondary" size="sm" onclick={openCurrentOfficialModelPage}><Icon icon="lucide:external-link" width="14" height="14" />Official</Button>
				{/if}
				<Button variant="ghost" size="sm" onclick={() => goto('/ai')}><Icon icon="lucide:arrow-left" width="14" height="14" />Back</Button>
			{/snippet}
		</PageHeader>
		<PageContent>
			<div class="flex-1 overflow-y-auto p-6 space-y-5">
				{#if !model}
					<Card class="p-5"><p class="text-sm font-semibold text-text">AI Model not found</p><p class="mt-1 text-xs text-text-muted">Open AI Models and select an available Runtime Box.</p></Card>
				{:else if model.status !== 'installed'}
					<Card class="p-5">
						{#if installBlock}
							<p class="text-sm font-semibold text-text">Incompatible host</p><p class="mt-1 text-xs leading-relaxed text-amber-700">{installBlock.reason}</p>
						{:else}
							<p class="text-sm font-semibold text-text">Install required</p><p class="mt-1 text-xs text-text-muted">Install this Runtime Box before running the model.</p>
						{/if}
					</Card>
				{:else}
					<Card class="p-5 space-y-4">
						<div><div class="flex items-center gap-1"><p class="text-sm font-semibold text-text">Input</p><InfoPopup text={AI_MODEL_INPUT_HELP.runInput} /></div><p class="mt-1 text-xs text-text-muted">{model.runtime.name} · single-cell</p></div>
						<fieldset disabled={modelRunActive} class="space-y-4 disabled:opacity-70">
							<FilePickerPopup files={h5adFiles} value={inputFile} label="AnnData file" info={inputHelp} testId="ai-model-input-file" emptyText="No h5ad files in Data yet." disabled={modelRunActive} artifactRequirement={singleCellAnnDataRequirement(modelId, humanOnlyModel ? 'human' : species)} onchange={(path) => (inputFile = path)} />
							{#if inputFile && inputCompatibility && inputCompatibilityMessage}
								<div class="text-xs leading-relaxed {inputCompatibility.status === 'incompatible' ? 'text-red-600' : 'text-amber-700'}">
									<p data-testid="ai-input-compatibility">{inputCompatibilityMessage}</p>
									{#if inputCompatibilityDiagnostics.length > 1}
										<details class="mt-1">
											<summary class="cursor-pointer select-none opacity-80 hover:opacity-100">
												Show details ({inputCompatibilityDiagnostics.length - 1} more)
											</summary>
											<ul class="mt-1 list-disc space-y-1 pl-4" data-testid="ai-input-compatibility-details">
												{#each inputCompatibilityDiagnostics.slice(1) as item (item.code)}
													<li>{item.message}{item.action ? ` ${item.action}` : ''}</li>
												{/each}
											</ul>
										</details>
									{/if}
								</div>
							{/if}
							<div class="grid grid-cols-1 {humanOnlyModel ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-3">
								{#if !humanOnlyModel}
									<div><LabelWithInfo targetId="species" text="Species" info={AI_MODEL_INPUT_HELP.uceSpecies} /><Select id="species" value={species} options={uceSpeciesOptions} disabled={modelRunActive} onchange={(value) => (species = value)} /></div>
								{/if}
								<div><LabelWithInfo targetId="batch-size" text="Batch size" info={AI_MODEL_INPUT_HELP.uceBatchSize} /><input id="batch-size" type="number" min="1" max={batchSizeMax} bind:value={batchSize} disabled={modelRunActive} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:border-brand transition-colors" /></div>
								<div><LabelWithInfo targetId="csv-rows" text="CSV rows" info={AI_MODEL_INPUT_HELP.uceCsvRows} /><input id="csv-rows" type="number" min="1" max="5000" bind:value={maxCsvRows} disabled={modelRunActive} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:border-brand transition-colors" /></div>
							</div>
						</fieldset>
						<div class="flex items-center gap-3 pt-1">
							<Button variant="primary" testId="ai-model-run" disabled={!canRun} loading={running} onclick={runModel}>Run</Button>
							{#if running}<Button variant="secondary" size="sm" onclick={cancelModelRun}>Cancel</Button>{/if}
							{#if modelRunActive && runStartedAt}<span class="text-xs text-text-subtle">Elapsed: {fmtDuration(runStartedAt, now)}</span>{/if}
							{#if activeModelJob && !running}<Button variant="ghost" size="sm" onclick={() => goto('/jobs')}><Icon icon="lucide:radio" width="13" height="13" />Open Jobs</Button>{/if}
						</div>
					</Card>
				{/if}

				{#if running && logLines.length > 0}
					<Card class="p-4"><p class="mb-2 text-[10px] font-semibold text-text-subtle uppercase tracking-wider">Current run log</p><pre class="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-text-secondary font-mono">{sanitizeLocalPathsForDisplay(logLines.join('\n'), 2)}</pre></Card>
				{:else if activeModelJob && !running}
					<Card class="p-4"><div class="flex items-center justify-between gap-3"><div><p class="mb-1 text-[10px] font-semibold text-text-subtle uppercase tracking-wider">Active AI Model job</p><p class="text-xs text-text-secondary">This model is still running in Jobs. Inputs are locked until the job exits.</p></div><Button variant="ghost" size="sm" onclick={() => goto('/jobs')}>Open Jobs</Button></div></Card>
				{/if}

				{#if displayError}
					<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono" data-selectable>{sanitizeLocalPathsForDisplay(displayError, 2)}</div>
					<RunRecord runId={selectedRunId} />
				{:else if loadingOutput}
					<div class="flex justify-center py-12"><Icon icon="svg-spinners:ring-resize" width="22" height="22" class="text-text-subtle" /></div>
				{:else if loadedOutput}
					<div><p class="mb-2 text-[10px] font-semibold text-text-subtle uppercase tracking-wider">Last run result</p><div class="flex items-center justify-between mb-3"><h2 class="text-xs font-medium text-text-secondary">{selectedRun?.label ?? 'Results'}</h2>{#if selectedRun}<span class="text-xs text-text-subtle">{fmtDate(selectedRun.startedAt)} · {fmtDuration(selectedRun.startedAt, selectedRun.endedAt)}</span>{/if}</div><ToolResultView output={loadedOutput} outputFiles={selectedRunOutputFiles} /><RunRecord runId={selectedRunId} /></div>
				{/if}
			</div>
		</PageContent>
	</div>
</div>
{/if}
