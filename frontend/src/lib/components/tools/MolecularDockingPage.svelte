<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import {
    LIATIR_STRUCTURE_PROFILE_V1,
    MOLECULAR_DOCKING_INTERPRETATION_NOTICE,
    MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID,
    VINA_MAX_SEED,
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
    molecularDockingDefinition,
    preflightDockingWithRuntime,
    receptorPreparationDefinition,
    runDockingWithRuntime,
    type DockingResourcePreflight,
    type DockingToolMode,
  } from '$lib/tools/molecular-docking/docking';
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

  let { mode }: { mode: DockingToolMode } = $props();

  // Receptor preparation
  let inputStructure = $state('');
  let keepChains = $state('');
  let removeWaters = $state(true);
  let removeResidueNames = $state<string[]>([]);
  let addMissingAtoms = $state(true);
  let addMissingResidues = $state(false);
  let replaceNonstandardResidues = $state(false);
  let ph = $state(7.4);
  // Docking
  let receptorPdbqt = $state('');
  let receptorStructure = $state('');
  let ligandsSdf = $state('');
  let siteMode = $state<'reference-ligand' | 'box'>('reference-ligand');
  let referenceLigand = $state('');
  let paddingAngstrom = $state(5);
  let center = $state<[number | '', number | '', number | '']>(['', '', '']);
  let size = $state<[number, number, number]>([20, 20, 20]);
  let scoringFunction = $state<'vina' | 'vinardo'>('vina');
  let exhaustiveness = $state(8);
  let numPoses = $state(9);
  let energyRange = $state(3);
  let seed = $state(42);
  let cpuThreads = $state(4);
  let addLigandHydrogens = $state(true);
  let screeningDatabase = $state('');

  let checking = $state(false);
  let checkedFingerprint = $state('');
  let preflight = $state<DockingResourcePreflight | null>(null);
  let preflightError = $state<string | null>(null);
  let beyondEvidenceAccepted = $state(false);
  let host = $state<LiatirHardwareHostMemory>({ totalMemoryBytes: null });
  let running = $state(false);
  let activeExecutionRunId = $state<string | null>(null);
  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);
  let logs = $state<string[]>([]);

  const definition = $derived(mode === 'prepare-receptor' ? receptorPreparationDefinition : molecularDockingDefinition);
  const runtime = $derived(toolRuntimesStore.runtimes.find((item) => item.id === MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID) ?? null);
  const structureFiles = $derived(dataFiles.files.filter((file) => /\.(?:pdb|cif|mmcif)$/iu.test(file.path)));
  const pdbFiles = $derived(dataFiles.files.filter((file) => /\.pdb$/iu.test(file.path)));
  const pdbqtFiles = $derived(dataFiles.files.filter((file) => /\.pdbqt$/iu.test(file.path)));
  const sdfFiles = $derived(dataFiles.files.filter((file) => /\.sdf$/iu.test(file.path)));
  const databaseFiles = $derived(dataFiles.files.filter((file) => /\.db$/iu.test(file.path)));
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
  const inputsReady = $derived(mode === 'prepare-receptor'
    ? !!inputStructure
    : !!receptorPdbqt && !!ligandsSdf && (siteMode === 'box' || !!referenceLigand));
  const canCheck = $derived(runtime?.status === 'installed' && inputsReady && !runActive && !checking);
  const beyondEvidence = $derived(preflight?.estimate.accepted === true && preflight.estimate.confirmationRequired);
  const canRun = $derived(
    canCheck && preflight?.estimate.accepted === true && checkedFingerprint === currentFingerprint
    && (!beyondEvidence || beyondEvidenceAccepted)
  );
  const nonWaterHeterogens = $derived((preflight?.metrics.heterogens ?? []).filter((item) => item.kind !== 'water'));
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
      // The residue list belongs to the structure, so it survives option changes (choosing what to
      // remove is one of them) and is cleared only when another structure is picked.
      if (mode !== 'prepare-receptor') preflight = null;
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
    void aiModelsStore.ensureHardwareInfo().then((info) => {
      host = { totalMemoryBytes: info?.totalMemoryBytes ?? null };
      const cores = info?.cpuCores;
      if (typeof cores === 'number' && cores > 0) cpuThreads = Math.max(1, Math.min(cores - 1, 4));
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
    if (mode === 'prepare-receptor') {
      return {
        inputStructure,
        keepChains,
        removeWaters: String(removeWaters),
        removeResidueNames: removeResidueNames.join(','),
        addMissingAtoms: String(addMissingAtoms),
        addMissingResidues: String(addMissingResidues),
        replaceNonstandardResidues: String(replaceNonstandardResidues),
        ph: String(ph),
      };
    }
    return {
      receptorPdbqt,
      receptorStructure,
      ligandsSdf,
      siteMode,
      referenceLigand: siteMode === 'reference-ligand' ? referenceLigand : '',
      paddingAngstrom: String(paddingAngstrom),
      centerX: String(center[0]), centerY: String(center[1]), centerZ: String(center[2]),
      sizeX: String(size[0]), sizeY: String(size[1]), sizeZ: String(size[2]),
      scoringFunction,
      exhaustiveness: String(exhaustiveness),
      numPoses: String(numPoses),
      energyRangeKcalPerMol: String(energyRange),
      seed: String(seed),
      cpuThreads: String(cpuThreads),
      addLigandHydrogens: String(addLigandHydrogens),
      screeningDatabase,
    };
  }

  function inputPaths(params: Record<string, string>): string[] {
    const keys = mode === 'prepare-receptor'
      ? ['inputStructure']
      : ['receptorPdbqt', 'receptorStructure', 'ligandsSdf', 'referenceLigand', 'screeningDatabase'];
    return keys.map((key) => params[key]).filter(Boolean);
  }

  function durationLabel(milliseconds: number): string {
    if (milliseconds < 60_000) return `${Math.max(1, Math.round(milliseconds / 1000))} s`;
    if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)} min`;
    return `${(milliseconds / 3_600_000).toFixed(1)} h`;
  }

  function toggleResidue(name: string, remove: boolean) {
    removeResidueNames = remove
      ? [...new Set([...removeResidueNames, name])]
      : removeResidueNames.filter((item) => item !== name);
  }

  async function checkRun() {
    if (!runtime || !canCheck) return;
    checking = true;
    preflightError = null;
    preflight = null;
    try {
      const fingerprint = currentFingerprint;
      const result = await preflightDockingWithRuntime(runtime, mode, buildParams(), host);
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
    const paths = inputPaths(params);
    const inputSizes = paths.map((path) => inputSize(path) ?? 0);
    const execution = createLiatirRootExecutionIdentity({
      runId, runKind: 'tool-runtime', workspaceId, entityId: definition.id,
    });
    const label = mode === 'prepare-receptor'
      ? `${basename(inputStructure)} · receptor`
      : `${basename(ligandsSdf)} → ${basename(receptorPdbqt)}`;
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
        runKind: 'tool-runtime-direct',
        execution,
        analysisRunId: runId,
        toolId: definition.id,
        label,
        inputPaths: paths,
        inputSizes,
        params,
        startedAt,
        outputDir,
        signal: executionRuns.signal(runId),
        onJobId: (jobId) => void executionRuns.attachJob(runId, jobId).catch(() => {}),
      };
      const result = await runDockingWithRuntime(runtime, mode, params, outputDir, onLog, context,
        { host, confirmedBeyondEvidence: beyondEvidenceAccepted });
      const endedAt = Date.now();
      await finalizeExecutionResult(runId, 'done', {
        id: runId, tool: definition.id, label, inputs: paths, inputSizes, outputFiles: result.outputFiles,
        sideEffects: [], params, startedAt, endedAt, durationMs: endedAt - startedAt, output: result.output,
        error: null, log: logs,
      });
      toast.success(mode === 'prepare-receptor' ? 'Receptor ready for docking' : 'Docking finished');
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
          <Card class="p-5"><p class="text-sm font-semibold text-text">Runtime not published</p><p class="mt-1 text-xs text-text-muted">This tool stays disabled until the signed molecular docking Tool Runtime passes scientific and product validation.</p></Card>
        {:else if runtime.status !== 'installed'}
          {@const blocked = toolRuntimesStore.installBlock(runtime.id)}
          <Card class="p-5" testId="docking-install-required">
            <p class="text-sm font-semibold text-text">{blocked ? blocked.summary : 'Install required'}</p>
            <p class="mt-1 text-xs text-text-muted">{blocked ? blocked.reason : 'Install the AutoDock Vina Tool Runtime from Dependencies first. It is a scientific Tool Runtime, not an AI Model.'}</p>
            {#if runtime.install.hostRequirements?.reason}<p class="mt-2 text-xs text-text-subtle">{runtime.install.hostRequirements.reason}</p>{/if}
          </Card>
        {:else}
          <Card class="p-5 space-y-4">
            <fieldset disabled={runActive || checking} class="space-y-4 disabled:opacity-70">
              {#if mode === 'prepare-receptor'}
                <FilePickerPopup files={structureFiles} value={inputStructure} label="Protein structure (PDB or mmCIF)" testId="docking-input-structure" artifactRequirement={structureRequirement} emptyText="No structures in Data yet." onchange={(path) => { inputStructure = path; removeResidueNames = []; preflight = null; }} />
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><label for="docking-chains" class="text-xs text-text-secondary">Chains to keep (empty keeps all)</label><input id="docking-chains" type="text" placeholder="A" bind:value={keepChains} class={inputClass} /></div>
                  <div><label for="docking-ph" class="text-xs text-text-secondary">Protonation pH</label><input id="docking-ph" type="number" min="0" max="14" step="0.1" bind:value={ph} class={inputClass} /></div>
                  <label class="flex items-center gap-2 text-xs text-text-secondary mt-5"><input type="checkbox" bind:checked={removeWaters} />Remove crystallographic waters</label>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label class="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" bind:checked={addMissingAtoms} />Repair missing heavy atoms</label>
                  <label class="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" bind:checked={addMissingResidues} />Model missing internal residues</label>
                  <label class="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" bind:checked={replaceNonstandardResidues} />Replace non-standard residues</label>
                </div>
                {#if nonWaterHeterogens.length}
                  <div class="rounded-lg border border-border bg-surface-2 p-3" data-testid="docking-heterogens">
                    <p class="text-xs font-medium text-text-secondary mb-2">Other residues in this structure — tick only those to remove</p>
                    <div class="flex flex-wrap gap-3">
                      {#each nonWaterHeterogens as item (item.name)}
                        <label class="flex items-center gap-2 text-xs"><input type="checkbox" checked={removeResidueNames.includes(item.name)} onchange={(event) => toggleResidue(item.name, (event.currentTarget as HTMLInputElement).checked)} />{item.name} · {item.kind === 'ion' ? 'ion' : 'ligand or cofactor'} · {item.residues}×</label>
                      {/each}
                    </div>
                    <p class="mt-2 text-[11px] text-text-subtle">Keep cofactors and metal ions the binding site needs. A residue without a docking template stops the run with its name rather than being dropped.</p>
                  </div>
                {/if}
                <p class="text-xs text-text-subtle">Every hydrogen is re-assigned with OpenMM's rules at this pH. To dock against a receptor protonated elsewhere, use its PDBQT directly in Molecular Docking.</p>
              {:else}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FilePickerPopup files={pdbqtFiles} value={receptorPdbqt} label="Receptor for docking (PDBQT)" testId="docking-receptor-pdbqt" emptyText="Prepare a receptor first, or add a PDBQT to Data." onchange={(path) => (receptorPdbqt = path)} />
                  <FilePickerPopup files={pdbFiles} value={receptorStructure} label="Prepared receptor (PDB, optional)" testId="docking-receptor-structure" info="Adds the receptor with its best pose to the Result." emptyText="No PDB files in Data." onchange={(path) => (receptorStructure = path)} />
                </div>
                <FilePickerPopup files={sdfFiles} value={ligandsSdf} label="Ligands (SDF, one or many)" testId="docking-ligands" emptyText="No SDF files in Data." onchange={(path) => (ligandsSdf = path)} />
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><label for="docking-site" class="text-xs text-text-secondary">Binding site</label><select id="docking-site" bind:value={siteMode} class={inputClass}><option value="reference-ligand">Around a reference ligand</option><option value="box">Explicit box</option></select></div>
                  {#if siteMode === 'reference-ligand'}
                    <div class="md:col-span-1"><FilePickerPopup files={sdfFiles} value={referenceLigand} label="Reference ligand (SDF)" testId="docking-reference-ligand" emptyText="No SDF files in Data." onchange={(path) => (referenceLigand = path)} /></div>
                    <div><label for="docking-padding" class="text-xs text-text-secondary">Padding (Å)</label><input id="docking-padding" type="number" min="0" max="30" step="0.5" bind:value={paddingAngstrom} class={inputClass} /></div>
                  {/if}
                </div>
                {#if siteMode === 'box'}
                  <div class="grid grid-cols-3 md:grid-cols-6 gap-3">
                    {#each ['x', 'y', 'z'] as axis, index (axis)}
                      <div><label for="docking-center-{axis}" class="text-xs text-text-secondary">Centre {axis} (Å)</label><input id="docking-center-{axis}" type="number" step="0.001" bind:value={center[index]} class={inputClass} /></div>
                    {/each}
                    {#each ['x', 'y', 'z'] as axis, index (axis)}
                      <div><label for="docking-size-{axis}" class="text-xs text-text-secondary">Size {axis} (Å)</label><input id="docking-size-{axis}" type="number" min="1" max="126" step="0.5" bind:value={size[index]} class={inputClass} /></div>
                    {/each}
                  </div>
                {/if}
                <div class="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <div><label for="docking-sf" class="text-xs text-text-secondary">Scoring</label><select id="docking-sf" bind:value={scoringFunction} class={inputClass}><option value="vina">Vina</option><option value="vinardo">Vinardo</option></select></div>
                  <div><label for="docking-exh" class="text-xs text-text-secondary">Exhaustiveness</label><input id="docking-exh" type="number" min="1" max="512" step="1" bind:value={exhaustiveness} class={inputClass} /></div>
                  <div><label for="docking-poses" class="text-xs text-text-secondary">Poses per ligand</label><input id="docking-poses" type="number" min="1" max="50" step="1" bind:value={numPoses} class={inputClass} /></div>
                  <div><label for="docking-range" class="text-xs text-text-secondary">Energy range</label><input id="docking-range" type="number" min="0.1" max="20" step="0.5" bind:value={energyRange} class={inputClass} /></div>
                  <div><label for="docking-seed" class="text-xs text-text-secondary">Seed</label><input id="docking-seed" type="number" min="1" max={VINA_MAX_SEED} step="1" bind:value={seed} class={inputClass} /></div>
                  <div><label for="docking-cpu" class="text-xs text-text-secondary">CPU threads</label><input id="docking-cpu" type="number" min="1" step="1" bind:value={cpuThreads} class={inputClass} /></div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label class="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" bind:checked={addLigandHydrogens} />Add missing ligand hydrogens (charge state as drawn)</label>
                  <FilePickerPopup files={databaseFiles} value={screeningDatabase} label="Extend a screening database (optional)" info="Only a database from the same receptor, site and settings is accepted." emptyText="No screening databases in Data." onchange={(path) => (screeningDatabase = path)} />
                </div>
              {/if}
            </fieldset>

            <p class="text-xs text-amber-700">{MOLECULAR_DOCKING_INTERPRETATION_NOTICE}</p>
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" testId="docking-preflight" disabled={!canCheck} loading={checking} onclick={checkRun}>Check run</Button>
              <Button variant="primary" testId="docking-run" disabled={!canRun} loading={running} onclick={runTool}>Run</Button>
              {#if activeExecutionRunId}<Button variant="secondary" testId="docking-cancel" onclick={() => executionRuns.cancel(activeExecutionRunId!)}>Cancel</Button>{/if}
              {#if activeJob && !running}<Button variant="ghost" onclick={() => goto('/jobs')}>Open Jobs</Button>{/if}
            </div>

            {#if preflight}
              <div class="rounded-lg border border-border bg-surface-2 p-3" data-testid="docking-estimate">
                <p class="text-xs font-medium text-text-secondary mb-2">
                  {preflight.estimate.accepted && preflight.estimate.evidence === 'measured'
                    ? 'Run estimate from retained measurements'
                    : 'This run is larger than anything measured'}
                </p>
                <div class="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                  <div><span class="text-text-subtle">{mode === 'prepare-receptor' ? 'Atoms' : 'Receptor atoms'}</span><p class="font-medium">{preflight.metrics.atomCount.toLocaleString()}</p></div>
                  {#if mode === 'dock'}<div><span class="text-text-subtle">Ligands</span><p class="font-medium">{preflight.metrics.tokenCount.toLocaleString()}</p></div>{/if}
                  {#if preflight.estimate.accepted && preflight.estimate.evidence === 'measured'}
                    <div><span class="text-text-subtle">RAM</span><p class="font-medium">{fmtBytes(preflight.estimate.estimatedRamBytes)}</p></div>
                    <div><span class="text-text-subtle">Time</span><p class="font-medium">{durationLabel(preflight.estimate.estimatedTimeMs)}</p></div>
                    <div><span class="text-text-subtle">Output</span><p class="font-medium">{fmtBytes(preflight.estimate.estimatedOutputBytes)}</p></div>
                  {:else if preflight.estimate.accepted}
                    <div><span class="text-text-subtle">Largest measured so far</span><p class="font-medium">{preflight.estimate.maxValidatedTokenCount.toLocaleString()} ligands · {preflight.estimate.maxValidatedAtomCount.toLocaleString()} atoms</p></div>
                    <div><span class="text-text-subtle">At least</span><p class="font-medium">{preflight.estimate.minimumRamBytes === null ? 'Unknown' : fmtBytes(preflight.estimate.minimumRamBytes)}</p></div>
                  {/if}
                </div>
                {#if preflight.metrics.site?.largeSearchSpace}<p class="mt-2 text-xs text-amber-700">The search box exceeds 27,000 Å³, where Vina warns that searching becomes less reliable. Raise exhaustiveness or shrink the box.</p>{/if}
                {#if preflight.metrics.oversizedLigands?.length}<p class="mt-2 text-xs text-amber-700">These molecules exceed the size docking supports and will be rejected: {preflight.metrics.oversizedLigands.join(', ')}</p>{/if}
              </div>
            {/if}
            {#if preflight?.estimate.accepted && preflight.estimate.confirmationRequired}
              <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p>Nobody has measured a run this size on this kind of computer, so the memory and time it needs are unknown. It may work, it may be slow, or it may stop. Nothing else you have open is affected, and the result will record that this run went beyond measured evidence.</p>
                <label class="mt-2 flex items-center gap-2 font-medium"><input type="checkbox" data-testid="docking-accept-beyond-evidence" bind:checked={beyondEvidenceAccepted} />Run it anyway</label>
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
