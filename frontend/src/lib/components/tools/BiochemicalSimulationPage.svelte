<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import {
    BIOCHEMICAL_BUILTIN_MODELS,
    BIOCHEMICAL_SIMULATION_INTERPRETATION_NOTICE,
    BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID,
    createLiatirRootExecutionIdentity,
    type LiatirBiochemicalBuiltinModel,
    type LiatirBiochemicalMethod,
    type LiatirHardwareHostMemory,
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
    biochemicalSimulationDefinition as definition,
    preflightBiochemicalWithRuntime,
    runBiochemicalWithRuntime,
    type BiochemicalResourcePreflight,
  } from '$lib/tools/biochemical-simulation/biochemical';
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

  let source = $state<'builtin' | 'bngl'>('builtin');
  let builtinModel = $state<LiatirBiochemicalBuiltinModel>('robertson');
  let bngl = $state('');
  let method = $state<LiatirBiochemicalMethod>('ode');
  let tEnd = $state(100);
  let points = $state(101);
  let spacing = $state<'linear' | 'log'>('linear');
  let tFirst = $state('');
  let rtol = $state(1e-8);
  let atol = $state(1e-12);
  let runs = $state(100);
  let seed = $state(1);
  let parameters = $state('');

  let checking = $state(false);
  let checkedFingerprint = $state('');
  let preflight = $state<BiochemicalResourcePreflight | null>(null);
  let preflightError = $state<string | null>(null);
  let beyondEvidenceAccepted = $state(false);
  let host = $state<LiatirHardwareHostMemory>({ totalMemoryBytes: null });
  let running = $state(false);
  let activeExecutionRunId = $state<string | null>(null);
  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);
  let logs = $state<string[]>([]);

  const runtime = $derived(toolRuntimesStore.runtimes.find((item) => item.id === BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID) ?? null);
  const bnglFiles = $derived(dataFiles.files.filter((file) => /\.bngl$/iu.test(file.path)));
  const history = $derived(analysisRuns.byTool(definition.id));
  const selectedRun = $derived(history.find((run) => run.id === selectedRunId) ?? null);
  const activeJob = $derived(jobsStore.jobs.find((job) =>
    job.status.type === 'running'
    && job.kind === 'tool-runtime-python'
    && metadataString(job, 'runKind') === 'tool-runtime-direct'
    && metadataString(job, 'toolId') === definition.id
  ) ?? null);
  const runActive = $derived(running || !!activeJob);
  const currentFingerprint = $derived(JSON.stringify(buildParams()));
  const canCheck = $derived(runtime?.status === 'installed' && (source === 'builtin' || !!bngl) && !runActive && !checking);
  const beyondEvidence = $derived(preflight?.estimate.accepted === true && preflight.estimate.confirmationRequired);
  const canRun = $derived(
    canCheck && preflight?.estimate.accepted === true && checkedFingerprint === currentFingerprint
    && (!beyondEvidence || beyondEvidenceAccepted)
  );

  $effect(() => {
    if (method === 'ssa' && spacing === 'log') spacing = 'linear';
  });

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
    return {
      source, ...(source === 'builtin' ? { builtinModel } : { bngl }), method, tEnd: String(tEnd), points: String(points),
      spacing, ...(spacing === 'log' && tFirst.trim() ? { tFirst } : {}),
      ...(method === 'ode' ? { rtol: String(rtol), atol: String(atol) } : { runs: String(runs), seed: String(seed) }),
      parameters,
    };
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
      const result = await preflightBiochemicalWithRuntime(runtime, buildParams(), host);
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
    const paths = source === 'bngl' ? [bngl] : [];
    const inputSizes = paths.map((path) => dataFiles.files.find((file) => file.path === path)?.size ?? 0);
    const execution = createLiatirRootExecutionIdentity({ runId, runKind: 'tool-runtime', workspaceId, entityId: definition.id });
    const label = `${source === 'builtin' ? builtinModel : basename(bngl)} · ${method === 'ode' ? 'deterministic' : `${runs} stochastic runs`}`;
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
      const result = await runBiochemicalWithRuntime(runtime, params, outputDir, onLog, context,
        { host, confirmedBeyondEvidence: beyondEvidenceAccepted });
      const endedAt = Date.now();
      await finalizeExecutionResult(runId, 'done', {
        id: runId, tool: definition.id, label, inputs: paths, inputSizes, outputFiles: result.outputFiles,
        sideEffects: [], params, startedAt, endedAt, durationMs: endedAt - startedAt, output: result.output,
        error: null, log: logs,
      });
      toast.success('Simulation finished');
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
      {#if history.length}<span class="text-xs text-text-subtle">{history.length}</span>{/if}
    </div>
    <div class="flex-1 overflow-y-auto py-1 bg-surface">
      {#if history.length === 0}<p class="text-xs text-text-subtle text-center py-8">No runs yet.</p>{/if}
      {#each history as run (run.id)}
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
          <Card class="p-5"><p class="text-sm font-semibold text-text">Runtime not published</p><p class="mt-1 text-xs text-text-muted">This tool stays disabled until the signed biochemical simulation Tool Runtime passes scientific and product validation.</p></Card>
        {:else if runtime.status !== 'installed'}
          {@const blocked = toolRuntimesStore.installBlock(runtime.id)}
          <Card class="p-5" testId="biochemical-install-required">
            <p class="text-sm font-semibold text-text">{blocked ? blocked.summary : 'Install required'}</p>
            <p class="mt-1 text-xs text-text-muted">{blocked ? blocked.reason : 'Install the PySB Tool Runtime from Dependencies first. It is a scientific Tool Runtime, not an AI Model.'}</p>
            {#if runtime.install.hostRequirements?.reason}<p class="mt-2 text-xs text-text-subtle">{runtime.install.hostRequirements.reason}</p>{/if}
          </Card>
        {:else}
          <Card class="p-5 space-y-4">
            <fieldset disabled={runActive || checking} class="space-y-4 disabled:opacity-70">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label for="biochemical-source" class="text-xs text-text-secondary">Model</label><select id="biochemical-source" data-testid="biochemical-source" bind:value={source} class={inputClass}>
                  <option value="builtin">A model that ships with PySB</option>
                  <option value="bngl">A BNGL file</option>
                </select></div>
                {#if source === 'builtin'}
                  <div><label for="biochemical-builtin" class="text-xs text-text-secondary">Built-in model</label><select id="biochemical-builtin" data-testid="biochemical-builtin" bind:value={builtinModel} class={inputClass}>
                    {#each Object.entries(BIOCHEMICAL_BUILTIN_MODELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
                  </select></div>
                {/if}
              </div>
              {#if source === 'bngl'}
                <FilePickerPopup files={bnglFiles} value={bngl} label="BNGL model" testId="biochemical-bngl" info="BioNetGen Language: molecules, rules and observables. The file's own actions are not run; this tool generates the network and simulates it with the settings below." emptyText="No BNGL files in Data." onchange={(path) => (bngl = path)} />
              {/if}
              <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div><label for="biochemical-method" class="text-xs text-text-secondary">Method</label><select id="biochemical-method" data-testid="biochemical-method" bind:value={method} class={inputClass}>
                  <option value="ode">Deterministic (ODE)</option>
                  <option value="ssa">Stochastic (Gillespie SSA)</option>
                </select></div>
                <div><label for="biochemical-tend" class="text-xs text-text-secondary">End time (the model's time unit)</label><input id="biochemical-tend" data-testid="biochemical-tend" type="number" min="0" bind:value={tEnd} class={inputClass} /></div>
                <div><label for="biochemical-points" class="text-xs text-text-secondary">Output points</label><input id="biochemical-points" type="number" min="2" step="1" bind:value={points} class={inputClass} /></div>
                <div><label for="biochemical-spacing" class="text-xs text-text-secondary">Time spacing</label><select id="biochemical-spacing" bind:value={spacing} class={inputClass}>
                  <option value="linear">Even</option>
                  <option value="log" disabled={method === 'ssa'}>Logarithmic</option>
                </select></div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                {#if spacing === 'log'}<div><label for="biochemical-tfirst" class="text-xs text-text-secondary">First output time (empty: a millionth of the end time)</label><input id="biochemical-tfirst" type="text" inputmode="decimal" bind:value={tFirst} class={inputClass} /></div>{/if}
                {#if method === 'ode'}
                  <div><label for="biochemical-rtol" class="text-xs text-text-secondary">Relative tolerance</label><input id="biochemical-rtol" type="number" step="any" bind:value={rtol} class={inputClass} /></div>
                  <div><label for="biochemical-atol" class="text-xs text-text-secondary">Absolute tolerance</label><input id="biochemical-atol" type="number" step="any" bind:value={atol} class={inputClass} /></div>
                {:else}
                  <div><label for="biochemical-runs" class="text-xs text-text-secondary">Runs</label><input id="biochemical-runs" data-testid="biochemical-runs" type="number" min="1" step="1" bind:value={runs} class={inputClass} /></div>
                  <div><label for="biochemical-seed" class="text-xs text-text-secondary">Seed of the first run</label><input id="biochemical-seed" type="number" min="1" step="1" bind:value={seed} class={inputClass} /></div>
                {/if}
              </div>
              <div><label for="biochemical-parameters" class="text-xs text-text-secondary">Parameter changes, one per line: name value</label><textarea id="biochemical-parameters" rows="3" placeholder="kA_syn 2" bind:value={parameters} class={inputClass}></textarea></div>
              <p class="text-xs text-text-subtle">
                {method === 'ode'
                  ? 'Deterministic: the average behaviour of many molecules, integrated with LSODA, which handles stiff systems.'
                  : 'Stochastic: each run follows individual reaction events, as in a small volume with few molecules. Run i uses the seed plus i, so every run differs and each can be repeated exactly.'}
              </p>
            </fieldset>

            <p class="text-xs text-amber-700">{BIOCHEMICAL_SIMULATION_INTERPRETATION_NOTICE}</p>
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" testId="biochemical-preflight" disabled={!canCheck} loading={checking} onclick={checkRun}>Check run</Button>
              <Button variant="primary" testId="biochemical-run" disabled={!canRun} loading={running} onclick={runTool}>Run</Button>
              {#if activeExecutionRunId}<Button variant="secondary" testId="biochemical-cancel" onclick={() => executionRuns.cancel(activeExecutionRunId!)}>Cancel</Button>{/if}
              {#if activeJob && !running}<Button variant="ghost" onclick={() => goto('/jobs')}>Open Jobs</Button>{/if}
            </div>
            {#if checking}<p class="text-xs text-text-subtle">Generating the reaction network from the model's rules…</p>{/if}

            {#if preflight}
              <div class="rounded-lg border border-border bg-surface-2 p-3" data-testid="biochemical-estimate">
                <p class="text-xs font-medium text-text-secondary mb-2">
                  {preflight.estimate.accepted && preflight.estimate.evidence === 'measured'
                    ? 'Run estimate from retained measurements'
                    : 'This run is larger than anything measured'}
                </p>
                <div class="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                  <div><span class="text-text-subtle">Species</span><p class="font-medium">{preflight.metrics.network.species.toLocaleString()}</p></div>
                  <div><span class="text-text-subtle">Reactions</span><p class="font-medium">{preflight.metrics.network.reactions.toLocaleString()}</p></div>
                  <div><span class="text-text-subtle">Output samples</span><p class="font-medium">{preflight.metrics.stepCount.toLocaleString()}</p></div>
                  {#if preflight.estimate.accepted && preflight.estimate.evidence === 'measured'}
                    <div><span class="text-text-subtle">RAM</span><p class="font-medium">{fmtBytes(preflight.estimate.estimatedRamBytes)}</p></div>
                    <div><span class="text-text-subtle">Time</span><p class="font-medium">{durationLabel(preflight.estimate.estimatedTimeMs)}</p></div>
                  {:else if preflight.estimate.accepted}
                    <div><span class="text-text-subtle">Largest measured so far</span><p class="font-medium">{preflight.estimate.maxValidatedAtomCount.toLocaleString()} species</p></div>
                  {/if}
                </div>
                {#if preflight.metrics.model.ignoredActions?.length}<p class="mt-2 text-xs text-text-subtle">Not run from the file: {preflight.metrics.model.ignoredActions.join(', ')}.</p>{/if}
              </div>
            {/if}
            {#if preflight?.estimate.accepted && preflight.estimate.confirmationRequired}
              <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p>Nobody has measured a run this size on this kind of computer, so the memory and time it needs are unknown. It may work, it may be slow, or it may stop. Nothing else you have open is affected, and the result will record that this run went beyond measured evidence.</p>
                <label class="mt-2 flex items-center gap-2 font-medium"><input type="checkbox" data-testid="biochemical-accept-beyond-evidence" bind:checked={beyondEvidenceAccepted} />Run it anyway</label>
              </div>
            {/if}
            {#if preflightError}<div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="biochemical-preflight-error">{preflightError}</div>{/if}
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
