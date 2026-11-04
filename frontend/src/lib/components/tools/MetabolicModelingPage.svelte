<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import {
    METABOLIC_MODELING_INTERPRETATION_NOTICE,
    METABOLIC_MODELING_RUNTIME_COMPONENT_ID,
    createLiatirRootExecutionIdentity,
    type LiatirHardwareHostMemory,
    type LiatirMetabolicAnalysis,
  } from '@liatir/core';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import PageContent from '$lib/components/layout/PageContent.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import RunRecord from '$lib/components/ui/RunRecord.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import { ensureRunOutputDir } from '$lib/execution/run-storage';
  import { finalizeExecutionResult } from '$lib/execution/finalization';
  import type { ToolRuntimeDirectRunContext } from '$lib/tool-runtimes/direct-run-context';
  import {
    metabolicModelingDefinition as definition,
    preflightMetabolicWithRuntime,
    runMetabolicWithRuntime,
    type MetabolicResourcePreflight,
  } from '$lib/tools/metabolic-modeling/metabolic';
  import { aiModelsStore } from '$lib/stores/aiModels.svelte';
  import { analysisRuns, type AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { jobsStore, type JobEntry } from '$lib/stores/jobs.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { toolRuntimesStore } from '$lib/stores/toolRuntimes.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import type { ToolOutput } from '$lib/types/tool-output';
  import { fmtBytes, fmtDuration, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { HEADER_HEIGHT } from '$lib/_constants';

  let model = $state('');
  let analysis = $state<LiatirMetabolicAnalysis>('fba');
  let objective = $state('');
  let direction = $state<'max' | 'min'>('max');
  let bounds = $state('');
  let knockouts = $state('');
  let fractionOfOptimum = $state(1);
  let pfba = $state(false);
  let crossCheck = $state(true);

  let checking = $state(false);
  let checkedFingerprint = $state('');
  let preflight = $state<MetabolicResourcePreflight | null>(null);
  let preflightError = $state<string | null>(null);
  let beyondEvidenceAccepted = $state(false);
  let host = $state<LiatirHardwareHostMemory>({ totalMemoryBytes: null });
  let running = $state(false);
  let activeExecutionRunId = $state<string | null>(null);
  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);
  let logs = $state<string[]>([]);

  const runtime = $derived(toolRuntimesStore.runtimes.find((item) => item.id === METABOLIC_MODELING_RUNTIME_COMPONENT_ID) ?? null);
  const modelFiles = $derived(dataFiles.files.filter((file) => /\.(?:xml|sbml|xml\.gz|sbml\.gz|json)$/iu.test(file.path)));
  const runs = $derived(analysisRuns.byTool(definition.id));
  const selectedRun = $derived(runs.find((run) => run.id === selectedRunId) ?? null);
  const activeJob = $derived(jobsStore.jobs.find((job) =>
    job.status.type === 'running'
    && job.kind === 'tool-runtime-python'
    && metadataString(job, 'runKind') === 'tool-runtime-direct'
    && metadataString(job, 'toolId') === definition.id
  ) ?? null);
  const runActive = $derived(running || !!activeJob);
  const currentFingerprint = $derived(JSON.stringify(buildParams()));
  const canCheck = $derived(runtime?.status === 'installed' && !!model && !runActive && !checking);
  const beyondEvidence = $derived(preflight?.estimate.accepted === true && preflight.estimate.confirmationRequired);
  const canRun = $derived(
    canCheck && preflight?.estimate.accepted === true && checkedFingerprint === currentFingerprint
    && (!beyondEvidence || beyondEvidenceAccepted)
  );

  $effect(() => {
    const fingerprint = currentFingerprint;
    if (checkedFingerprint && checkedFingerprint !== fingerprint) {
      checkedFingerprint = '';
      preflight = null;
      preflightError = null;
      beyondEvidenceAccepted = false;
    }
  });

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
    void aiModelsStore.ensureHardwareInfo().then((info) => { host = { totalMemoryBytes: info?.totalMemoryBytes ?? null }; });
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
    return path.split(/[\\/]/u).pop() ?? path;
  }

  function buildParams(): Record<string, string> {
    return { model, analysis, objective, direction, bounds, knockouts, fractionOfOptimum: String(fractionOfOptimum),
      pfba: String(pfba), crossCheck: String(crossCheck) };
  }

  function durationLabel(milliseconds: number): string {
    if (milliseconds < 60_000) return `${Math.max(1, Math.round(milliseconds / 1000))} s`;
    if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)} min`;
    return `${(milliseconds / 3_600_000).toFixed(1)} h`;
  }

  async function checkRun() {
    if (!runtime || !canCheck) return;
    checking = true;
    preflightError = null;
    preflight = null;
    try {
      const fingerprint = currentFingerprint;
      const result = await preflightMetabolicWithRuntime(runtime, buildParams(), host);
      if (currentFingerprint !== fingerprint) return;
      preflight = result;
      checkedFingerprint = fingerprint;
      if (!result.estimate.accepted) preflightError = result.estimate.error;
    } catch (error) {
      preflightError = error instanceof Error ? error.message : String(error);
      checkedFingerprint = currentFingerprint;
    } finally {
      checking = false;
    }
  }

  async function runTool() {
    const workspaceId = workspaceStore.activeId;
    if (!runtime || !workspaceId || !canRun) return;
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    const params = buildParams();
    const paths = [model];
    const inputSizes = [dataFiles.files.find((file) => file.path === model)?.size ?? 0];
    const execution = createLiatirRootExecutionIdentity({ runId, runKind: 'tool-runtime', workspaceId, entityId: definition.id });
    const label = `${basename(model)} · ${analysis}`;
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
      await executionRuns.begin({ identity: execution, label, resultPolicy: 'own', resultId: runId, inputs: paths, params });
      const outputDir = await ensureRunOutputDir(runId);
      const context: ToolRuntimeDirectRunContext = {
        runKind: 'tool-runtime-direct', execution, analysisRunId: runId, toolId: definition.id, label, inputPaths: paths,
        inputSizes, params, startedAt, outputDir, signal: executionRuns.signal(runId),
        onJobId: (jobId) => void executionRuns.attachJob(runId, jobId).catch(() => {}),
      };
      const result = await runMetabolicWithRuntime(runtime, params, outputDir, onLog, context,
        { host, confirmedBeyondEvidence: beyondEvidenceAccepted });
      const endedAt = Date.now();
      await finalizeExecutionResult(runId, 'done', {
        id: runId, tool: definition.id, label, inputs: paths, inputSizes, outputFiles: result.outputFiles,
        sideEffects: [], params, startedAt, endedAt, durationMs: endedAt - startedAt, output: result.output,
        error: null, log: logs,
      });
      toast.success('Metabolic analysis finished');
    } catch (error) {
      const endedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = executionRuns.byId(runId)?.status === 'cancelling'
        || (error instanceof DOMException && error.name === 'AbortError');
      if (executionRuns.byId(runId)) {
        await finalizeExecutionResult(runId, cancelled ? 'cancelled' : 'error', {
          id: runId, tool: definition.id, label, inputs: paths, inputSizes, sideEffects: [], params, startedAt,
          endedAt, durationMs: endedAt - startedAt, output: null,
          error: cancelled ? 'Tool Runtime run was cancelled.' : message, log: [...logs, `Error: ${message}`],
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

  const inputClass = 'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm';
</script>

<div class="flex h-full overflow-hidden">
  <div class="w-56 shrink-0 border-r border-border flex flex-col">
    <div class="flex items-end justify-between px-3 py-3 border-b border-border bg-surface" style="height: {HEADER_HEIGHT}px;">
      <span class="text-sm font-medium text-text-secondary">Run history</span>
      {#if runs.length}<span class="text-xs text-text-subtle">{runs.length}</span>{/if}
    </div>
    <div class="flex-1 overflow-y-auto py-1 bg-surface">
      {#if runs.length === 0}<p class="text-xs text-text-subtle text-center py-8">No runs yet.</p>{/if}
      {#each runs as run (run.id)}
        <div class="group flex items-start {selectedRunId === run.id ? 'bg-brand/8' : 'hover:bg-surface-2'}">
          <button class="flex-1 text-left px-3 py-2.5 min-w-0" onclick={() => (selectedRunId = run.id)}>
            <p class="text-xs font-medium truncate">{run.label}</p>
            <p class="text-[10px] text-text-subtle">{new Date(run.startedAt).toLocaleDateString()} · {fmtDuration(run.startedAt, run.endedAt)}</p>
          </button>
          <button class="opacity-0 group-hover:opacity-100 p-2 text-text-subtle hover:text-red-500" aria-label="Delete run" onclick={() => deleteRun(run)}><Icon icon="lucide:x" width="11" /></button>
        </div>
      {/each}
    </div>
  </div>

  <div class="flex-1 flex flex-col overflow-hidden">
    <PageHeader title={definition.label} description={definition.description}>
      {#snippet actions()}<Button variant="ghost" size="sm" onclick={() => goto('/tools')}><Icon icon="lucide:arrow-left" width="14" />Back</Button>{/snippet}
    </PageHeader>
    <PageContent>
      <div class="flex-1 overflow-y-auto p-6 space-y-5">
        {#if !runtime}
          <Card class="p-5"><p class="text-sm font-semibold text-text">Runtime not published</p><p class="mt-1 text-xs text-text-muted">This tool stays disabled until the signed metabolic modeling Tool Runtime passes scientific and product validation.</p></Card>
        {:else if runtime.status !== 'installed'}
          {@const blocked = toolRuntimesStore.installBlock(runtime.id)}
          <Card class="p-5" testId="metabolic-install-required">
            <p class="text-sm font-semibold text-text">{blocked ? blocked.summary : 'Install required'}</p>
            <p class="mt-1 text-xs text-text-muted">{blocked ? blocked.reason : 'Install the COBRApy Tool Runtime from Dependencies first. It is a scientific Tool Runtime, not an AI Model.'}</p>
            {#if runtime.install.hostRequirements?.reason}<p class="mt-2 text-xs text-text-subtle">{runtime.install.hostRequirements.reason}</p>{/if}
          </Card>
        {:else}
          <Card class="p-5 space-y-4">
            <fieldset disabled={runActive || checking} class="space-y-4 disabled:opacity-70">
              <FilePickerPopup files={modelFiles} value={model} label="Metabolic model (SBML or COBRA JSON)" testId="metabolic-model" info="Genome-scale models from BiGG or BioModels are SBML; download them first, this tool works offline." emptyText="No SBML or JSON models in Data." onchange={(path) => (model = path)} />
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div><label for="metabolic-analysis" class="text-xs text-text-secondary">Analysis</label><select id="metabolic-analysis" data-testid="metabolic-analysis" bind:value={analysis} class={inputClass}>
                  <option value="fba">Flux balance analysis (FBA)</option>
                  <option value="fva">Flux variability analysis (FVA)</option>
                  <option value="gene-deletion">Single gene deletions</option>
                  <option value="reaction-deletion">Single reaction deletions</option>
                </select></div>
                <div><label for="metabolic-objective" class="text-xs text-text-secondary">Reaction to optimize (empty: the model's own)</label><input id="metabolic-objective" type="text" placeholder="Biomass reaction" bind:value={objective} class={inputClass} /></div>
                <div><label for="metabolic-direction" class="text-xs text-text-secondary">Direction</label><select id="metabolic-direction" bind:value={direction} class={inputClass}><option value="max">Maximize</option><option value="min">Minimize</option></select></div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label for="metabolic-bounds" class="text-xs text-text-secondary">Bound changes, one per line: reaction lower upper</label><textarea id="metabolic-bounds" rows="3" placeholder="EX_glc__D_e -10 1000" bind:value={bounds} class={inputClass}></textarea></div>
                <div><label for="metabolic-knockouts" class="text-xs text-text-secondary">Genes to knock out (comma-separated)</label><textarea id="metabolic-knockouts" rows="3" placeholder="b1779" bind:value={knockouts} class={inputClass}></textarea></div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                {#if analysis === 'fva'}<div><label for="metabolic-fraction" class="text-xs text-text-secondary">Fraction of the optimum to keep</label><input id="metabolic-fraction" type="number" min="0" max="1" step="0.05" bind:value={fractionOfOptimum} class={inputClass} /></div>{/if}
                {#if analysis === 'fba'}<label class="flex items-center gap-2 text-xs text-text-secondary mt-5"><input type="checkbox" bind:checked={pfba} />Least total flux among the optimal solutions (pFBA)</label>{/if}
                <label class="flex items-center gap-2 text-xs text-text-secondary mt-5"><input type="checkbox" data-testid="metabolic-cross-check" bind:checked={crossCheck} />Confirm with a second solver (GLPK)</label>
              </div>
              <p class="text-xs text-text-subtle">HiGHS solves every problem. With confirmation on, GLPK — an independent solver — solves it again, and the result is refused if the two disagree.</p>
            </fieldset>

            <p class="text-xs text-amber-700">{METABOLIC_MODELING_INTERPRETATION_NOTICE}</p>
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" testId="metabolic-preflight" disabled={!canCheck} loading={checking} onclick={checkRun}>Check run</Button>
              <Button variant="primary" testId="metabolic-run" disabled={!canRun} loading={running} onclick={runTool}>Run</Button>
              {#if activeExecutionRunId}<Button variant="secondary" testId="metabolic-cancel" onclick={() => executionRuns.cancel(activeExecutionRunId!)}>Cancel</Button>{/if}
              {#if activeJob && !running}<Button variant="ghost" onclick={() => goto('/jobs')}>Open Jobs</Button>{/if}
            </div>

            {#if preflight}
              <div class="rounded-lg border border-border bg-surface-2 p-3" data-testid="metabolic-estimate">
                <p class="text-xs font-medium text-text-secondary mb-2">
                  {preflight.estimate.accepted && preflight.estimate.evidence === 'measured'
                    ? 'Run estimate from retained measurements'
                    : 'This run is larger than anything measured'}
                </p>
                <div class="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                  <div><span class="text-text-subtle">Reactions</span><p class="font-medium">{preflight.metrics.model.reactions.toLocaleString()}</p></div>
                  <div><span class="text-text-subtle">Genes</span><p class="font-medium">{preflight.metrics.model.genes.toLocaleString()}</p></div>
                  <div><span class="text-text-subtle">Problems to solve</span><p class="font-medium">{preflight.metrics.stepCount.toLocaleString()}</p></div>
                  {#if preflight.estimate.accepted && preflight.estimate.evidence === 'measured'}
                    <div><span class="text-text-subtle">RAM</span><p class="font-medium">{fmtBytes(preflight.estimate.estimatedRamBytes)}</p></div>
                    <div><span class="text-text-subtle">Time</span><p class="font-medium">{durationLabel(preflight.estimate.estimatedTimeMs)}</p></div>
                  {:else if preflight.estimate.accepted}
                    <div><span class="text-text-subtle">Largest measured so far</span><p class="font-medium">{preflight.estimate.maxValidatedAtomCount.toLocaleString()} reactions</p></div>
                  {/if}
                </div>
                {#if !preflight.metrics.model.hasObjective && !objective}<p class="mt-2 text-xs text-amber-700">The model defines no objective: name the reaction to optimize.</p>{/if}
              </div>
            {/if}
            {#if preflight?.estimate.accepted && preflight.estimate.confirmationRequired}
              <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p>Nobody has measured a run this size on this kind of computer, so the memory and time it needs are unknown. It may work, it may be slow, or it may stop. Nothing else you have open is affected, and the result will record that this run went beyond measured evidence.</p>
                <label class="mt-2 flex items-center gap-2 font-medium"><input type="checkbox" data-testid="metabolic-accept-beyond-evidence" bind:checked={beyondEvidenceAccepted} />Run it anyway</label>
              </div>
            {/if}
            {#if preflightError}<div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{preflightError}</div>{/if}
          </Card>
        {/if}

        {#if running && logs.length}<Card class="p-4"><pre class="max-h-48 overflow-auto whitespace-pre-wrap text-xs font-mono">{sanitizeLocalPathsForDisplay(logs.join('\n'), 2)}</pre></Card>{/if}
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
