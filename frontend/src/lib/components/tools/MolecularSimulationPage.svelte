<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import {
    LIATIR_STRUCTURE_PROFILE_V1,
    OPENMM_INTERPRETATION_NOTICE,
    OPENMM_MAX_SEED,
    OPENMM_RUNTIME_COMPONENT_ID,
    createLiatirRootExecutionIdentity,
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
    molecularDynamicsDefinition,
    molecularRelaxationDefinition,
    preflightOpenMMWithRuntime,
    runOpenMMWithRuntime,
    type OpenMMResourcePreflight,
    type OpenMMToolMode,
  } from '$lib/tools/molecular-simulation/openmm';
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

  let { mode }: { mode: OpenMMToolMode } = $props();

  let inputStructure = $state('');
  let ligandSdf = $state('');
  let addHydrogens = $state(true);
  let ph = $state(7.4);
  let solvent = $state<'none' | 'tip3p-fb'>('none');
  let solventPaddingNm = $state(1);
  let ionicStrengthM = $state(0.15);
  let maxIterations = $state(5000);
  let tolerance = $state(10);
  let preset = $state<'verification-10ps' | 'short-100ps' | 'custom'>('verification-10ps');
  let customDurationPs = $state(1000);
  let temperatureKelvin = $state(300);
  let pressureBar = $state('');
  let saveIntervalPs = $state(1);
  let seed = $state(17);
  let checkpointPath = $state('');
  let checkpointMetadataPath = $state('');
  let checking = $state(false);
  let checkedFingerprint = $state('');
  let preflight = $state<OpenMMResourcePreflight | null>(null);
  let preflightError = $state<string | null>(null);
  let beyondEvidenceAccepted = $state(false);
  let host = $state<LiatirHardwareHostMemory>({ totalMemoryBytes: null });
  let running = $state(false);
  let activeExecutionRunId = $state<string | null>(null);
  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);
  let logs = $state<string[]>([]);

  const definition = $derived(mode === 'relaxation' ? molecularRelaxationDefinition : molecularDynamicsDefinition);
  const runtime = $derived(toolRuntimesStore.runtimes.find((item) => item.id === OPENMM_RUNTIME_COMPONENT_ID) ?? null);
  const structureFiles = $derived(dataFiles.files.filter((file) => /\.(?:pdb|cif|mmcif)$/iu.test(file.path)));
  const sdfFiles = $derived(dataFiles.files.filter((file) => /\.sdf$/iu.test(file.path)));
  const checkpointFiles = $derived(dataFiles.files.filter((file) => /\.chk$/iu.test(file.path)));
  const metadataFiles = $derived(dataFiles.files.filter((file) => /\.json$/iu.test(file.path)));
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
  const canCheck = $derived(runtime?.status === 'installed' && !!inputStructure && !runActive && !checking);
  const beyondEvidence = $derived(
    preflight?.estimate.accepted === true && preflight.estimate.confirmationRequired
  );
  const canRun = $derived(
    canCheck && preflight?.estimate.accepted === true && checkedFingerprint === currentFingerprint
    && (!beyondEvidence || beyondEvidenceAccepted)
  );
  const structureRequirement = {
    profiles: [{ ...LIATIR_STRUCTURE_PROFILE_V1 }],
    formats: ['pdb', 'mmcif'],
    scientificTypes: ['molecular-structure'],
    validation: 'valid-or-partial' as const,
  };

  $effect(() => {
    const fingerprint = currentFingerprint;
    if (checkedFingerprint && checkedFingerprint !== fingerprint) {
      checkedFingerprint = '';
      preflight = null;
      preflightError = null;
      // A new input has not been acknowledged, whatever the previous one was.
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
    void aiModelsStore.ensureHardwareInfo().then((info) => {
      host = { totalMemoryBytes: info?.totalMemoryBytes ?? null };
    });
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

  function inputSize(path: string): number | undefined {
    return dataFiles.files.find((file) => file.path === path)?.size;
  }

  function buildParams(): Record<string, string> {
    return {
      inputStructure,
      ligandSdf,
      addHydrogens: String(addHydrogens),
      ph: String(ph),
      solvent,
      solventPaddingNm: String(solventPaddingNm),
      ionicStrengthM: String(ionicStrengthM),
      maxIterations: String(maxIterations),
      toleranceKilojoulePerMoleNanometer: String(tolerance),
      preset,
      customDurationPs: String(customDurationPs),
      temperatureKelvin: String(temperatureKelvin),
      pressureBar: solvent === 'none' ? '' : pressureBar,
      saveIntervalPs: String(saveIntervalPs),
      seed: String(seed),
      checkpointPath,
      checkpointMetadataPath,
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
      const result = await preflightOpenMMWithRuntime(runtime, mode, buildParams(), host);
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
    const inputPaths = [
      inputStructure,
      ...(ligandSdf ? [ligandSdf] : []),
      ...(mode === 'dynamics' && checkpointPath ? [checkpointPath, checkpointMetadataPath] : []),
    ];
    const inputSizes = inputPaths.map((path) => inputSize(path) ?? 0);
    const execution = createLiatirRootExecutionIdentity({
      runId,
      runKind: 'tool-runtime',
      workspaceId,
      entityId: definition.id,
    });
    const label = `${basename(inputStructure)} · ${mode === 'relaxation' ? 'relaxation' : 'dynamics'}`;
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
        label,
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
        toolId: definition.id,
        label,
        inputPaths,
        inputSizes,
        params,
        startedAt,
        outputDir,
        signal: executionRuns.signal(runId),
        onJobId: (jobId) => void executionRuns.attachJob(runId, jobId).catch(() => {}),
      };
      const result = await runOpenMMWithRuntime(runtime, mode, params, outputDir, onLog, context,
        { host, confirmedBeyondEvidence: beyondEvidenceAccepted });
      const endedAt = Date.now();
      await finalizeExecutionResult(runId, 'done', {
        id: runId,
        tool: definition.id,
        label,
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
      toast.success(mode === 'relaxation' ? 'Relaxed structure ready' : 'Trajectory ready');
    } catch (error) {
      const endedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = executionRuns.byId(runId)?.status === 'cancelling'
        || (error instanceof DOMException && error.name === 'AbortError');
      if (executionRuns.byId(runId)) {
        await finalizeExecutionResult(runId, cancelled ? 'cancelled' : 'error', {
          id: runId,
          tool: definition.id,
          label,
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
          <Card class="p-5"><p class="text-sm font-semibold text-text">Runtime not published</p><p class="mt-1 text-xs text-text-muted">This tool stays disabled until an exact signed OpenMM target passes scientific and product validation.</p></Card>
        {:else if runtime.status !== 'installed'}
          <Card class="p-5"><p class="text-sm font-semibold text-text">Install required</p><p class="mt-1 text-xs text-text-muted">Install the OpenMM Tool Runtime from Dependencies first.</p></Card>
        {:else}
          <Card class="p-5 space-y-4">
            <fieldset disabled={runActive || checking} class="space-y-4 disabled:opacity-70">
              <FilePickerPopup files={structureFiles} value={inputStructure} label="Input PDB or mmCIF structure" testId="openmm-input-structure" artifactRequirement={structureRequirement} emptyText="No structures in Data yet." onchange={(path) => (inputStructure = path)} />
              <FilePickerPopup files={sdfFiles} value={ligandSdf} label="Ligand SDF (optional)" info="Use one ligand already present in the input structure." emptyText="No SDF files in Data." onchange={(path) => (ligandSdf = path)} />
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label class="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" data-testid="openmm-add-hydrogens" bind:checked={addHydrogens} />Add missing hydrogens</label>
                <div><label for="openmm-ph" class="text-xs text-text-secondary">Preparation pH</label><input id="openmm-ph" type="number" min="0" max="14" step="0.1" bind:value={ph} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                <div><label for="openmm-solvent" class="text-xs text-text-secondary">Solvent</label><select id="openmm-solvent" bind:value={solvent} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"><option value="none">No explicit solvent</option><option value="tip3p-fb">TIP3P-FB water</option></select></div>
              </div>
              {#if solvent === 'tip3p-fb'}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><label for="openmm-padding" class="text-xs text-text-secondary">Water padding (nm)</label><input id="openmm-padding" type="number" min="0.001" step="0.1" bind:value={solventPaddingNm} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                  <div><label for="openmm-ionic" class="text-xs text-text-secondary">Ionic strength (M)</label><input id="openmm-ionic" type="number" min="0" max="1" step="0.01" bind:value={ionicStrengthM} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                </div>
              {/if}

              {#if mode === 'relaxation'}
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><label for="openmm-iterations" class="text-xs text-text-secondary">Maximum iterations</label><input id="openmm-iterations" type="number" min="1" step="1" bind:value={maxIterations} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                  <div><label for="openmm-tolerance" class="text-xs text-text-secondary">Tolerance (kJ/mol/nm)</label><input id="openmm-tolerance" type="number" min="0.000001" step="1" bind:value={tolerance} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                  <div><label for="openmm-seed" class="text-xs text-text-secondary">Seed</label><input id="openmm-seed" type="number" min="1" max={OPENMM_MAX_SEED} step="1" bind:value={seed} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                </div>
              {:else}
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><label for="openmm-preset" class="text-xs text-text-secondary">Duration</label><select id="openmm-preset" bind:value={preset} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"><option value="verification-10ps">10 ps verification</option><option value="short-100ps">100 ps short run</option><option value="custom">Custom</option></select></div>
                  {#if preset === 'custom'}<div><label for="openmm-custom-duration" class="text-xs text-text-secondary">Custom duration (ps)</label><input id="openmm-custom-duration" type="number" min="0.002" step="0.002" bind:value={customDurationPs} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>{/if}
                  <div><label for="openmm-temperature" class="text-xs text-text-secondary">Temperature (K)</label><input id="openmm-temperature" type="number" min="0.001" step="1" bind:value={temperatureKelvin} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                  <div><label for="openmm-pressure" class="text-xs text-text-secondary">Pressure (bar, optional)</label><input id="openmm-pressure" type="number" min="0.001" step="0.1" bind:value={pressureBar} disabled={solvent === 'none'} placeholder={solvent === 'none' ? 'Requires water' : '1'} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm disabled:opacity-50" /></div>
                  <div><label for="openmm-save" class="text-xs text-text-secondary">Save interval (ps)</label><input id="openmm-save" type="number" min="0.002" step="0.002" bind:value={saveIntervalPs} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                  <div><label for="openmm-seed" class="text-xs text-text-secondary">Seed</label><input id="openmm-seed" type="number" min="1" max={OPENMM_MAX_SEED} step="1" bind:value={seed} class="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" /></div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FilePickerPopup files={checkpointFiles} value={checkpointPath} label="Resume checkpoint (optional)" emptyText="No OpenMM checkpoints in Data." onchange={(path) => (checkpointPath = path)} />
                  <FilePickerPopup files={metadataFiles} value={checkpointMetadataPath} label="Matching checkpoint metadata" emptyText="No checkpoint metadata in Data." onchange={(path) => (checkpointMetadataPath = path)} />
                </div>
              {/if}
            </fieldset>

            <p class="text-xs text-amber-700">{OPENMM_INTERPRETATION_NOTICE}</p>
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" testId="openmm-preflight" disabled={!canCheck} loading={checking} onclick={checkRun}>Check run</Button>
              <Button variant="primary" testId="openmm-run" disabled={!canRun} loading={running} onclick={runTool}>Run</Button>
              {#if activeExecutionRunId}<Button variant="secondary" testId="openmm-cancel" onclick={() => executionRuns.cancel(activeExecutionRunId!)}>Cancel</Button>{/if}
              {#if activeJob && !running}<Button variant="ghost" onclick={() => goto('/jobs')}>Open Jobs</Button>{/if}
            </div>

            {#if preflight}
              <div class="rounded-lg border border-border bg-surface-2 p-3" data-testid="openmm-estimate">
                <p class="text-xs font-medium text-text-secondary mb-2">
                  {preflight.estimate.accepted && preflight.estimate.evidence === 'measured'
                    ? 'Run estimate from retained measurements'
                    : 'This run is larger than anything measured'}
                </p>
                <div class="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                  <div><span class="text-text-subtle">Prepared atoms (upper estimate)</span><p class="font-medium">{preflight.metrics.atomCount.toLocaleString()}</p></div>
                  <div><span class="text-text-subtle">Saved items</span><p class="font-medium">{preflight.metrics.outputItemCount.toLocaleString()}</p></div>
                  {#if preflight.estimate.accepted && preflight.estimate.evidence === 'measured'}
                    <div><span class="text-text-subtle">RAM</span><p class="font-medium">{fmtBytes(preflight.estimate.estimatedRamBytes)}</p></div>
                    <div><span class="text-text-subtle">VRAM</span><p class="font-medium">{preflight.estimate.estimatedVramBytes === null ? 'Not used' : fmtBytes(preflight.estimate.estimatedVramBytes)}</p></div>
                    <div><span class="text-text-subtle">Time</span><p class="font-medium">{durationLabel(preflight.estimate.estimatedTimeMs)}</p></div>
                    <div><span class="text-text-subtle">Output</span><p class="font-medium">{fmtBytes(preflight.estimate.estimatedOutputBytes)}</p></div>
                  {:else if preflight.estimate.accepted}
                    <div><span class="text-text-subtle">Largest measured so far</span><p class="font-medium">{preflight.estimate.maxValidatedAtomCount.toLocaleString()} atoms</p></div>
                    <div><span class="text-text-subtle">At least</span><p class="font-medium">{preflight.estimate.minimumRamBytes === null ? 'Unknown' : fmtBytes(preflight.estimate.minimumRamBytes)}</p></div>
                    <div><span class="text-text-subtle">This computer has</span><p class="font-medium">{host.totalMemoryBytes === null ? 'Unknown' : fmtBytes(host.totalMemoryBytes)}</p></div>
                  {/if}
                </div>
              </div>
            {/if}
            {#if preflight?.estimate.accepted && preflight.estimate.confirmationRequired}
              <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p>
                  Nobody has measured a run this size on this kind of computer, so the memory and time
                  it needs are unknown. It may work, it may be slow, or it may run out of memory and
                  stop. Nothing else you have open is affected, and the result will record that this
                  run went beyond measured evidence.
                </p>
                <label class="mt-2 flex items-center gap-2 font-medium">
                  <input type="checkbox" data-testid="openmm-accept-beyond-evidence" bind:checked={beyondEvidenceAccepted} />
                  Run it anyway
                </label>
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
