<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import { createLiatirRootExecutionIdentity } from '@liatir/core';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import PageContent from '$lib/components/layout/PageContent.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import RunRecord from '$lib/components/ui/RunRecord.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import { aiModelsStore } from '$lib/stores/aiModels.svelte';
  import { analysisRuns, type AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { jobsStore, type JobEntry } from '$lib/stores/jobs.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { ensureRunOutputDir } from '$lib/execution/run-storage';
  import { finalizeExecutionResult } from '$lib/execution/finalization';
  import type { AIDirectRunContext } from '$lib/ai/direct-run-context';
  import {
    mhcFlurryEpitopeDefinition,
    runMhcFlurryEpitopeStep,
  } from '$lib/tools/ai/mhcflurry-epitope';
  import type { ToolOutput } from '$lib/types/tool-output';
  import { fmtDuration, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { HEADER_HEIGHT } from '$lib/_constants';

  let { modelId }: { modelId: string } = $props();
  let inputKind = $state('fasta');
  let inputFile = $state('');
  let alleles = $state('HLA-A*02:01');
  let peptideLengths = $state('8,9,10,11');
  let mode = $state('presentation');
  let topCount = $state(50);
  let running = $state(false);
  let activeExecutionRunId = $state<string | null>(null);
  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);
  let logs = $state<string[]>([]);

  const model = $derived(aiModelsStore.byId(modelId));
  const inputFiles = $derived(dataFiles.files.filter((file) =>
    ['fasta', 'fa', 'faa', 'csv', 'tsv'].some((ext) => file.path.toLowerCase().endsWith(`.${ext}`))
  ));
  const modelRuns = $derived(
    analysisRuns.byTool(mhcFlurryEpitopeDefinition.id).filter((run) => run.params?.modelId === modelId)
  );
  const selectedRun = $derived(modelRuns.find((run) => run.id === selectedRunId) ?? null);
  const activeJob = $derived(jobsStore.jobs.find((job) =>
    job.status.type === 'running'
    && job.kind === 'ai-python'
    && metadataString(job, 'runKind') === 'ai-model-direct'
    && metadataString(job, 'toolId') === mhcFlurryEpitopeDefinition.id
    && metadataString(job, 'modelId') === modelId
  ) ?? null);
  const runActive = $derived(running || !!activeJob);
  const canRun = $derived(!!model && model.status === 'installed' && !!inputFile && !!alleles.trim() && !runActive);

  $effect(() => {
    const id = selectedRunId;
    if (!id) { loadedOutput = null; return; }
    loadingOutput = true;
    analysisRuns.loadOutput(id).then((output) => {
      if (selectedRunId === id) loadedOutput = output;
      loadingOutput = false;
    });
  });

  onMount(() => {
    void aiModelsStore.init();
    void analysisRuns.init();
    void dataFiles.init();
    void jobsStore.refresh();
  });

  function metadataString(job: JobEntry, key: string): string | null {
    const value = job.metadata?.[key];
    return typeof value === 'string' ? value : null;
  }

  function basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function inputSize(path: string): number | undefined {
    return dataFiles.files.find((file) => file.path === path)?.size;
  }

  async function runModel() {
    const workspaceId = workspaceStore.activeId;
    if (!model || !workspaceId || !canRun) return;
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    const inputSizes = [inputSize(inputFile) ?? 0];
    const params = {
      modelId: model.id,
      inputKind,
      inputFile,
      alleles,
      peptideLengths,
      mode,
      topCount: String(topCount),
    };
    const execution = createLiatirRootExecutionIdentity({
      runId,
      runKind: 'ai-model',
      workspaceId,
      entityId: model.id,
    });
    running = true;
    activeExecutionRunId = runId;
    selectedRunId = null;
    loadedOutput = null;
    logs = [];
    const onLog = (line: string) => {
      if (!line.trim()) return;
      logs = [...logs, line];
      void executionRuns.appendLog(runId, line, { stream: 'system' }).catch(() => {});
    };
    try {
      await executionRuns.begin({
        identity: execution,
        label: basename(inputFile),
        resultPolicy: 'own',
        resultId: runId,
        inputs: [inputFile],
        params,
      });
      const outputDir = await ensureRunOutputDir(runId);
      const context: AIDirectRunContext = {
        runKind: 'ai-model-direct',
        execution,
        analysisRunId: runId,
        toolId: mhcFlurryEpitopeDefinition.id,
        mode: 'mhc-class-i-epitope-prediction',
        label: basename(inputFile),
        inputPaths: [inputFile],
        inputSizes,
        params,
        startedAt,
        outputDir,
        signal: executionRuns.signal(runId),
        onJobId: (jobId) => void executionRuns.attachJob(runId, jobId).catch(() => {}),
      };
      const result = await runMhcFlurryEpitopeStep(params, outputDir, onLog, context);
      const endedAt = Date.now();
      await finalizeExecutionResult(runId, 'done', {
        id: runId,
        tool: mhcFlurryEpitopeDefinition.id,
        label: basename(inputFile),
        inputs: [inputFile],
        inputSizes,
        outputFiles: result.outputFiles,
        sideEffects: result.sideEffects,
        params,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        output: result.output,
        error: null,
        log: logs,
      });
      toast.success('MHC-I predictions complete');
    } catch (error) {
      const endedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = executionRuns.byId(runId)?.status === 'cancelling'
        || (error instanceof DOMException && error.name === 'AbortError');
      if (executionRuns.byId(runId)) {
        await finalizeExecutionResult(runId, cancelled ? 'cancelled' : 'error', {
          id: runId,
          tool: mhcFlurryEpitopeDefinition.id,
          label: basename(inputFile),
          inputs: [inputFile],
          inputSizes,
          sideEffects: [],
          params,
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          output: null,
          error: cancelled ? 'AI Model run was cancelled.' : message,
          log: [...logs, `Error: ${message}`],
        }).catch(() => {});
      }
      toast.error(message);
    } finally {
      running = false;
      activeExecutionRunId = null;
      selectedRunId = runId;
    }
  }

  async function deleteRun(run: AnalysisRunMeta) {
    if (runActive) return;
    const ok = await confirm({ title: 'Delete run', message: `Delete “${run.label}”?`, confirmLabel: 'Delete' });
    if (!ok) return;
    await analysisRuns.remove(run.id);
    if (selectedRunId === run.id) selectedRunId = null;
  }
</script>

<div class="flex h-full overflow-hidden">
  <div class="w-56 shrink-0 border-r border-border flex flex-col">
    <div class="flex items-end justify-between px-3 py-3 border-b border-border bg-surface" style="height: {HEADER_HEIGHT}px;">
      <span class="text-sm font-medium text-text-secondary">Run history</span>
      {#if modelRuns.length}<span class="text-xs text-text-subtle">{modelRuns.length}</span>{/if}
    </div>
    <div class="flex-1 overflow-y-auto py-1 bg-surface">
      {#if modelRuns.length === 0}
        <p class="text-xs text-text-subtle text-center py-8 px-3">No runs yet.</p>
      {:else}
        {#each modelRuns as run (run.id)}
          <div class="group flex items-start {selectedRunId === run.id ? 'bg-brand/8' : 'hover:bg-surface-2'}">
            <button class="flex-1 text-left px-3 py-2.5 min-w-0" onclick={() => (selectedRunId = run.id)}>
              <p class="text-xs font-medium truncate">{run.label}</p>
              <p class="text-[10px] text-text-subtle">{fmtDate(run.startedAt)} · {fmtDuration(run.startedAt, run.endedAt)}</p>
            </button>
            <button class="opacity-0 group-hover:opacity-100 p-2 text-text-subtle hover:text-red-500" aria-label="Delete run" onclick={() => deleteRun(run)}><Icon icon="lucide:x" width="11" /></button>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <div class="flex-1 flex flex-col overflow-hidden">
    <PageHeader title={model?.name ?? 'MHCflurry Class I Presentation'} description={mhcFlurryEpitopeDefinition.description}>
      {#snippet actions()}<Button variant="ghost" size="sm" onclick={() => goto('/ai')}><Icon icon="lucide:arrow-left" width="14" />Back</Button>{/snippet}
    </PageHeader>
    <PageContent>
      <div class="flex-1 overflow-y-auto p-6 space-y-5">
        {#if !model}
          <Card class="p-5"><p class="text-sm font-semibold text-text">Runtime not published</p><p class="mt-1 text-xs text-text-muted">This AI Model stays hidden until a signed target completes scientific validation and publication.</p></Card>
        {:else if model.status !== 'installed'}
          <Card class="p-5"><p class="text-sm font-semibold text-text">Install required</p><p class="mt-1 text-xs text-text-muted">Install the signed Runtime Box from AI Models first.</p></Card>
        {:else}
          <Card class="p-5 space-y-4">
            <fieldset disabled={runActive} class="space-y-4 disabled:opacity-70">
              <FilePickerPopup files={inputFiles} value={inputFile} label="Protein FASTA or peptide table" testId="mhc-input-file" emptyText="No compatible files in Data yet." disabled={runActive} onchange={(path) => (inputFile = path)} />
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label for="mhc-input-kind" class="text-xs text-text-secondary">Input type</label><Select id="mhc-input-kind" value={inputKind} options={[{ value: 'fasta', label: 'Protein FASTA' }, { value: 'peptide-table', label: 'Peptide table' }]} onchange={(value) => (inputKind = value)} /></div>
                <div><label for="mhc-mode" class="text-xs text-text-secondary">Prediction mode</label><Select id="mhc-mode" value={mode} options={[{ value: 'presentation', label: 'Presentation' }, { value: 'binding', label: 'Binding' }]} onchange={(value) => (mode = value)} /></div>
                <div><label for="mhc-alleles" class="text-xs text-text-secondary">HLA Class I alleles</label><input id="mhc-alleles" bind:value={alleles} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                <div><label for="mhc-lengths" class="text-xs text-text-secondary">Peptide lengths</label><input id="mhc-lengths" bind:value={peptideLengths} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                <div><label for="mhc-top" class="text-xs text-text-secondary">Top peptides</label><input id="mhc-top" type="number" min="1" max="5000" bind:value={topCount} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
              </div>
            </fieldset>
            <p class="text-xs text-amber-700">Predictions prioritize experimental candidates. They are not a validated vaccine, therapy, or diagnostic result.</p>
            <div class="flex gap-2"><Button variant="primary" testId="mhc-run" disabled={!canRun} loading={running} onclick={runModel}>Run</Button>{#if activeExecutionRunId}<Button variant="secondary" testId="mhc-cancel" onclick={() => executionRuns.cancel(activeExecutionRunId!)}>Cancel</Button>{/if}{#if activeJob && !running}<Button variant="ghost" onclick={() => goto('/jobs')}>Open Jobs</Button>{/if}</div>
          </Card>
        {/if}

        {#if running && logs.length}
          <Card class="p-4"><pre class="max-h-48 overflow-auto whitespace-pre-wrap text-xs font-mono">{sanitizeLocalPathsForDisplay(logs.join('\n'), 2)}</pre></Card>
        {/if}
        {#if selectedRun?.status === 'error'}
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{selectedRun.error}</div><RunRecord runId={selectedRunId} />
        {:else if loadingOutput}
          <div class="flex justify-center py-12"><Icon icon="svg-spinners:ring-resize" width="22" /></div>
        {:else if loadedOutput}
          <ToolResultView output={loadedOutput} outputFiles={selectedRun?.outputFiles ?? []} /><RunRecord runId={selectedRunId} />
        {/if}
      </div>
    </PageContent>
  </div>
</div>
