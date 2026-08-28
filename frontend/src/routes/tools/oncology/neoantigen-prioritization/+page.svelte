<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import { createLiatirRootExecutionIdentity, LIATIR_VEP_TUMOR_VCF_PROFILE_V1, PVACTOOLS_RUNTIME_COMPONENT_ID } from '@liatir/core';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import PageContent from '$lib/components/layout/PageContent.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import RunRecord from '$lib/components/ui/RunRecord.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import { analysisRuns, type AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { jobsStore, type JobEntry } from '$lib/stores/jobs.svelte';
  import { toolRuntimesStore } from '$lib/stores/toolRuntimes.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { ensureRunOutputDir } from '$lib/execution/run-storage';
  import { finalizeExecutionResult } from '$lib/execution/finalization';
  import type { ToolRuntimeDirectRunContext } from '$lib/tool-runtimes/direct-run-context';
  import {
    neoantigenPrioritizationDefinition,
    runNeoantigenPrioritizationWithRuntime,
  } from '$lib/tools/oncology/neoantigen-prioritization';
  import type { ToolOutput } from '$lib/types/tool-output';
  import { fmtDuration, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { HEADER_HEIGHT } from '$lib/_constants';

  let inputVcf = $state('');
  let tumorSample = $state('');
  let normalSample = $state('');
  let alleles = $state('HLA-A*02:01');
  let proximalVcf = $state('');
  let peptideLengths = $state('8,9,10,11');
  let passOnly = $state(false);
  let topCount = $state(100);
  let threads = $state(1);
  let running = $state(false);
  let activeExecutionRunId = $state<string | null>(null);
  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);
  let logs = $state<string[]>([]);

  const runtime = $derived(toolRuntimesStore.runtimes.find((item) => item.id === PVACTOOLS_RUNTIME_COMPONENT_ID) ?? null);
  const vcfFiles = $derived(dataFiles.files.filter((file) => file.path.toLowerCase().endsWith('.vcf') || file.path.toLowerCase().endsWith('.vcf.gz')));
  const proximalFiles = $derived(dataFiles.files.filter((file) => file.path.toLowerCase().endsWith('.vcf.gz')));
  const runs = $derived(analysisRuns.byTool(neoantigenPrioritizationDefinition.id));
  const selectedRun = $derived(runs.find((run) => run.id === selectedRunId) ?? null);
  const activeJob = $derived(jobsStore.jobs.find((job) =>
    job.status.type === 'running'
    && job.kind === 'tool-runtime-python'
    && metadataString(job, 'runKind') === 'tool-runtime-direct'
    && metadataString(job, 'toolId') === neoantigenPrioritizationDefinition.id
  ) ?? null);
  const runActive = $derived(running || !!activeJob);
  const canRun = $derived(
    runtime?.status === 'installed' && !!inputVcf && !!tumorSample.trim() && !!alleles.trim() && !runActive
  );
  const vcfRequirement = {
    profiles: [{ ...LIATIR_VEP_TUMOR_VCF_PROFILE_V1 }],
    formats: ['vcf'],
    scientificTypes: ['vep-annotated-tumor-variants'],
    validation: 'valid' as const,
  };

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
    void toolRuntimesStore.init();
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

  function inputSize(path: string): number | undefined {
    return dataFiles.files.find((file) => file.path === path)?.size;
  }

  async function runTool() {
    const workspaceId = workspaceStore.activeId;
    if (!runtime || !workspaceId || !canRun) return;
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    const inputPaths = [inputVcf, ...(proximalVcf ? [proximalVcf] : [])];
    const inputSizes = inputPaths.map((path) => inputSize(path) ?? 0);
    const params = {
      inputVcf,
      tumorSample: tumorSample.trim(),
      normalSample: normalSample.trim(),
      alleles,
      proximalVcf,
      peptideLengths,
      passOnly: String(passOnly),
      topCount: String(topCount),
      threads: String(threads),
    };
    const execution = createLiatirRootExecutionIdentity({
      runId,
      runKind: 'tool-runtime',
      workspaceId,
      entityId: neoantigenPrioritizationDefinition.id,
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
        label: `${tumorSample.trim()} · ${basename(inputVcf)}`,
        resultPolicy: 'own',
        resultId: runId,
        inputs: inputPaths,
        params,
      });
      const outputDir = await ensureRunOutputDir(runId);
      const context: ToolRuntimeDirectRunContext = {
        runKind: 'tool-runtime-direct',
        execution,
        analysisRunId: runId,
        toolId: neoantigenPrioritizationDefinition.id,
        label: `${tumorSample.trim()} · ${basename(inputVcf)}`,
        inputPaths,
        inputSizes,
        params,
        startedAt,
        outputDir,
        signal: executionRuns.signal(runId),
        onJobId: (jobId) => void executionRuns.attachJob(runId, jobId).catch(() => {}),
      };
      const result = await runNeoantigenPrioritizationWithRuntime(runtime, params, outputDir, onLog, context);
      const endedAt = Date.now();
      await finalizeExecutionResult(runId, 'done', {
        id: runId,
        tool: neoantigenPrioritizationDefinition.id,
        label: context.label,
        inputs: inputPaths,
        inputSizes,
        outputFiles: result.outputFiles,
        sideEffects: [],
        params,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        output: result.output,
        error: null,
        log: logs,
      });
      toast.success('Neoantigen candidates ready');
    } catch (error) {
      const endedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = executionRuns.byId(runId)?.status === 'cancelling'
        || (error instanceof DOMException && error.name === 'AbortError');
      if (executionRuns.byId(runId)) {
        await finalizeExecutionResult(runId, cancelled ? 'cancelled' : 'error', {
          id: runId,
          tool: neoantigenPrioritizationDefinition.id,
          label: `${tumorSample.trim()} · ${basename(inputVcf)}`,
          inputs: inputPaths,
          inputSizes,
          sideEffects: [],
          params,
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          output: null,
          error: cancelled ? 'Tool Runtime run was cancelled.' : message,
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
    if (!await confirm({ title: 'Delete run', message: `Delete “${run.label}”?`, confirmLabel: 'Delete' })) return;
    await analysisRuns.remove(run.id);
    if (selectedRunId === run.id) selectedRunId = null;
  }
</script>

<div class="flex h-full overflow-hidden">
  <div class="w-56 shrink-0 border-r border-border flex flex-col">
    <div class="flex items-end justify-between px-3 py-3 border-b border-border bg-surface" style="height: {HEADER_HEIGHT}px;"><span class="text-sm font-medium text-text-secondary">Run history</span>{#if runs.length}<span class="text-xs text-text-subtle">{runs.length}</span>{/if}</div>
    <div class="flex-1 overflow-y-auto py-1 bg-surface">
      {#if runs.length === 0}<p class="text-xs text-text-subtle text-center py-8">No runs yet.</p>{/if}
      {#each runs as run (run.id)}
        <div class="group flex items-start {selectedRunId === run.id ? 'bg-brand/8' : 'hover:bg-surface-2'}"><button class="flex-1 text-left px-3 py-2.5 min-w-0" onclick={() => (selectedRunId = run.id)}><p class="text-xs font-medium truncate">{run.label}</p><p class="text-[10px] text-text-subtle">{new Date(run.startedAt).toLocaleDateString()} · {fmtDuration(run.startedAt, run.endedAt)}</p></button><button class="opacity-0 group-hover:opacity-100 p-2 text-text-subtle hover:text-red-500" aria-label="Delete run" onclick={() => deleteRun(run)}><Icon icon="lucide:x" width="11" /></button></div>
      {/each}
    </div>
  </div>

  <div class="flex-1 flex flex-col overflow-hidden">
    <PageHeader title="Neoantigen Prioritization" description={neoantigenPrioritizationDefinition.description}>{#snippet actions()}<Button variant="ghost" size="sm" onclick={() => goto('/tools')}><Icon icon="lucide:arrow-left" width="14" />Back</Button>{/snippet}</PageHeader>
    <PageContent>
      <div class="flex-1 overflow-y-auto p-6 space-y-5">
        {#if !runtime}
          <Card class="p-5"><p class="text-sm font-semibold text-text">Runtime not published</p><p class="mt-1 text-xs text-text-muted">This tool stays disabled until a signed pVACseq target completes scientific validation and publication.</p></Card>
        {:else if runtime.status !== 'installed'}
          <Card class="p-5"><p class="text-sm font-semibold text-text">Install required</p><p class="mt-1 text-xs text-text-muted">Install the pVACseq Tool Runtime from Dependencies first.</p></Card>
        {:else}
          <Card class="p-5 space-y-4">
            <fieldset disabled={runActive} class="space-y-4 disabled:opacity-70">
              <FilePickerPopup files={vcfFiles} value={inputVcf} label="VEP-annotated tumor VCF" testId="pvac-input-vcf" artifactRequirement={vcfRequirement} emptyText="No VCF files in Data yet." onchange={(path) => (inputVcf = path)} />
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label for="pvac-tumor" class="text-xs text-text-secondary">Tumor sample</label><input id="pvac-tumor" bind:value={tumorSample} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                <div><label for="pvac-normal" class="text-xs text-text-secondary">Normal sample (optional)</label><input id="pvac-normal" bind:value={normalSample} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                <div><label for="pvac-alleles" class="text-xs text-text-secondary">HLA Class I alleles</label><input id="pvac-alleles" bind:value={alleles} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                <div><label for="pvac-lengths" class="text-xs text-text-secondary">Peptide lengths</label><input id="pvac-lengths" bind:value={peptideLengths} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                <div><label for="pvac-top" class="text-xs text-text-secondary">Candidate peptides</label><input id="pvac-top" type="number" min="1" max="5000" bind:value={topCount} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                <div><label for="pvac-threads" class="text-xs text-text-secondary">Worker threads</label><input id="pvac-threads" type="number" min="1" max="32" bind:value={threads} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
              </div>
              <FilePickerPopup files={proximalFiles} value={proximalVcf} label="Phased proximal variants VCF (optional)" emptyText="No compressed VCF files in Data." onchange={(path) => (proximalVcf = path)} />
              <label class="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" bind:checked={passOnly} />Use PASS variants only</label>
            </fieldset>
            <p class="text-xs text-amber-700">Outputs are experimental candidates. They are not a validated vaccine, therapy, or diagnostic result.</p>
            <div class="flex gap-2"><Button variant="primary" testId="pvac-run" disabled={!canRun} loading={running} onclick={runTool}>Run</Button>{#if activeExecutionRunId}<Button variant="secondary" testId="pvac-cancel" onclick={() => executionRuns.cancel(activeExecutionRunId!)}>Cancel</Button>{/if}{#if activeJob && !running}<Button variant="ghost" onclick={() => goto('/jobs')}>Open Jobs</Button>{/if}</div>
          </Card>
        {/if}

        {#if running && logs.length}<Card class="p-4"><pre class="max-h-48 overflow-auto whitespace-pre-wrap text-xs font-mono">{sanitizeLocalPathsForDisplay(logs.join('\n'), 2)}</pre></Card>{/if}
        {#if selectedRun?.status === 'error'}<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{selectedRun.error}</div><RunRecord runId={selectedRunId} />{:else if loadingOutput}<div class="flex justify-center py-12"><Icon icon="svg-spinners:ring-resize" width="22" /></div>{:else if loadedOutput}<ToolResultView output={loadedOutput} outputFiles={selectedRun?.outputFiles ?? []} /><RunRecord runId={selectedRunId} />{/if}
      </div>
    </PageContent>
  </div>
</div>
