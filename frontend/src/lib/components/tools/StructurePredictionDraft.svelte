<script lang="ts">
  import { untrack } from 'svelte';
  import {
    BOLTZ_2_MODEL_ID,
    PROTEIN_LIGAND_AFFINITY_TOOL_ID,
    adaptBoltz2Input,
    adaptProtenixInput,
    createLiatirRootExecutionIdentity,
    parseLiatirComplexSpecDraftJson,
    validateProteinLigandAffinityComplex,
    type LiatirAIModelRecord,
    type LiatirHardwareHostMemory,
    type LiatirStructurePredictionRequest,
    type LiatirStructureToolDraft,
  } from '@liatir/core';
  import ComplexInputEditor from './ComplexInputEditor.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import type { AIDirectRunContext } from '$lib/ai/direct-run-context';
  import { ensureRunOutputDir } from '$lib/execution/run-storage';
  import { finalizeExecutionResult } from '$lib/execution/finalization';
  import {
    preflightStructurePrediction,
    runStructurePrediction,
    structureRunParams,
    structureToolDefinition,
    type StructurePreflight,
  } from '$lib/tools/ai/structure-prediction';
  import type { DataFile } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { fmtBytes } from '$lib/utils';

  let { initial, models, files, host, onchange }: {
    initial: LiatirStructureToolDraft;
    models: LiatirAIModelRecord[];
    files: DataFile[];
    host: LiatirHardwareHostMemory;
    onchange: (draft: LiatirStructureToolDraft) => void;
  } = $props();
  // Mounted with a draft-ID key. A later selection cannot mutate this draft's async work.
  let draft = $state(untrack(() => structuredClone($state.snapshot(initial))));
  let spec = $state(untrack(() => parseLiatirComplexSpecDraftJson(initial.specJson).spec!));
  let editorValid = $state(true);
  let checking = $state(false);
  let preflight = $state<StructurePreflight | null>(null);
  let preflightError = $state<string | null>(null);
  let checkedFingerprint = $state('');
  let beyondEvidenceAccepted = $state(false);
  let running = $state(false);

  const affinity = $derived(draft.toolId === PROTEIN_LIGAND_AFFINITY_TOOL_ID);
  const request = $derived<LiatirStructurePredictionRequest>({
    modelId: draft.modelId, spec, msa: draft.msa,
    seed: draft.seed.trim() ? Number(draft.seed) : NaN,
    modelCount: draft.modelCount.trim() ? Number(draft.modelCount) : NaN,
  });
  const adapter = $derived(draft.modelId === BOLTZ_2_MODEL_ID
    ? adaptBoltz2Input(request, affinity ? spec.entities.find((entity) => entity.type === 'ligand')?.id : undefined)
    : adaptProtenixInput(request));
  const errors = $derived([
    ...adapter.errors,
    ...(affinity ? validateProteinLigandAffinityComplex(spec) : []),
  ]);
  const model = $derived(models.find((item) => item.id === draft.modelId));
  const linkedRun = $derived(draft.executionRunId
    ? analysisRuns.runs.find((run) => run.id === draft.executionRunId) ?? null
    : null);
  // The run belongs to this draft. While it runs, or once it produced a Result, the draft is the
  // record of that Result and stays read-only; a failed or cancelled run leaves it editable again.
  const locked = $derived(running || (draft.executionRunId !== null
    && linkedRun?.status !== 'error' && linkedRun?.status !== 'cancelled'));
  // One GPU runs one prediction. A second draft may be edited freely, but not started on the same
  // model until the first finishes.
  const gpuBusy = $derived(jobsStore.jobs.some((job) =>
    job.status.type === 'running' && job.kind === 'ai-python' && job.metadata?.modelId === draft.modelId));
  const fingerprint = $derived(JSON.stringify(structureRunParams(draft, spec)));
  const canCheck = $derived(model?.status === 'installed' && errors.length === 0 && editorValid
    && !locked && !checking && !gpuBusy);
  const beyondEvidence = $derived(preflight?.estimate.accepted === true && preflight.estimate.confirmationRequired);
  const canRun = $derived(canCheck && preflight?.estimate.accepted === true
    && checkedFingerprint === fingerprint && (!beyondEvidence || beyondEvidenceAccepted));

  $effect(() => {
    const snapshot = { ...$state.snapshot(draft), specJson: JSON.stringify(spec) };
    untrack(() => onchange(snapshot));
  });

  $effect(() => {
    const current = fingerprint;
    if (checkedFingerprint && checkedFingerprint !== current) {
      checkedFingerprint = '';
      preflight = null;
      preflightError = null;
      // A changed prediction has not been acknowledged, whatever the previous one was.
      beyondEvidenceAccepted = false;
    }
  });

  function durationLabel(milliseconds: number): string {
    if (milliseconds < 60_000) return `${Math.max(1, Math.round(milliseconds / 1000))} s`;
    if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)} min`;
    return `${(milliseconds / 3_600_000).toFixed(1)} h`;
  }

  async function checkRun() {
    if (!model || !canCheck) return;
    checking = true;
    preflight = null;
    preflightError = null;
    const current = fingerprint;
    try {
      const result = await preflightStructurePrediction(model, structureRunParams(draft, spec), host);
      if (fingerprint !== current) return;
      preflight = result;
      checkedFingerprint = current;
      if (!result.estimate.accepted) preflightError = result.estimate.error;
    } catch (error) {
      preflightError = error instanceof Error ? error.message : String(error);
      checkedFingerprint = current;
    } finally {
      checking = false;
    }
  }

  async function runPrediction() {
    const workspaceId = workspaceStore.activeId;
    if (!model || !workspaceId || !canRun || !preflight?.estimate.accepted) return;
    const definition = structureToolDefinition(draft.toolId);
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    const params = { ...structureRunParams(draft, spec), hardwareEstimate: JSON.stringify(preflight.estimate) };
    const inputPaths = [
      ...spec.entities.flatMap((entity) => entity.type === 'protein' && entity.msa ? [entity.msa.path] : []),
      ...(spec.templates ?? []).map((template) => template.path),
    ];
    const inputSizes = inputPaths.map((path) => files.find((file) => file.path === path)?.size ?? 0);
    const label = draft.label.trim() || definition.label;
    const execution = createLiatirRootExecutionIdentity({ runId, runKind: 'ai-model', workspaceId, entityId: model.id });
    const confirmed = beyondEvidenceAccepted;
    running = true;
    draft.executionRunId = runId;
    try {
      await executionRuns.begin({ identity: execution, label, resultPolicy: 'own', resultId: runId, inputs: inputPaths, params });
      const outputDir = await ensureRunOutputDir(runId);
      const onLog = (line: string) => {
        if (line.trim()) void executionRuns.appendLog(runId, line, { stream: 'system' }).catch(() => {});
      };
      const context: AIDirectRunContext = {
        runKind: 'ai-model-direct',
        execution,
        analysisRunId: runId,
        toolId: definition.id,
        mode: 'biomolecular-structure-prediction',
        label,
        inputPaths,
        inputSizes,
        params,
        startedAt,
        outputDir,
        signal: executionRuns.signal(runId),
        onJobId: (jobId) => void executionRuns.attachJob(runId, jobId).catch(() => {}),
      };
      const result = await runStructurePrediction(model, params, outputDir, onLog, context,
        { host, confirmedBeyondEvidence: confirmed });
      const endedAt = Date.now();
      await finalizeExecutionResult(runId, 'done', {
        id: runId, tool: definition.id, label, inputs: inputPaths, inputSizes,
        outputFiles: result.outputFiles, sideEffects: result.sideEffects, params,
        startedAt, endedAt, durationMs: endedAt - startedAt, output: result.output, error: null, log: [],
      });
      toast.success('Predicted structure ready');
    } catch (error) {
      const endedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = executionRuns.byId(runId)?.status === 'cancelling'
        || (error instanceof DOMException && error.name === 'AbortError');
      if (executionRuns.byId(runId)) {
        await finalizeExecutionResult(runId, cancelled ? 'cancelled' : 'error', {
          id: runId, tool: definition.id, label, inputs: inputPaths, inputSizes, sideEffects: [], params,
          startedAt, endedAt, durationMs: endedAt - startedAt, output: null,
          error: cancelled ? 'AI Model run was cancelled.' : message, log: [`Error: ${message}`],
        }).catch(() => {});
      }
      toast.error(message);
    } finally {
      running = false;
    }
  }
</script>

<section class="space-y-5" data-testid="structure-prediction-draft" data-draft-id={draft.id}>
  <fieldset disabled={locked} class="space-y-4 disabled:opacity-70">
    <label class="block text-sm">Analysis name
      <input data-testid="structure-draft-label" bind:value={draft.label} class="mt-1 block w-full rounded border border-border bg-surface p-2" />
    </label>
    <label class="block text-sm">AI Model
      <select data-testid="structure-model" bind:value={draft.modelId} class="mt-1 block w-full rounded border border-border bg-surface p-2">
        {#each models.filter((item) => !affinity || item.id === BOLTZ_2_MODEL_ID) as item}
          <option value={item.id}>{item.name}</option>
        {/each}
      </select>
    </label>
    <ComplexInputEditor bind:spec bind:msa={draft.msa} bind:valid={editorValid}
      bind:advanced={draft.advanced} bind:json={draft.advancedJson} {files} disabled={locked} />
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <label class="block text-sm">Seed (a number used to repeat a prediction)
        <input data-testid="structure-seed" inputmode="numeric" bind:value={draft.seed} class="mt-1 block w-full rounded border border-border bg-surface p-2" />
      </label>
      <label class="block text-sm">Number of predicted structures
        <input data-testid="structure-model-count" inputmode="numeric" bind:value={draft.modelCount} class="mt-1 block w-full rounded border border-border bg-surface p-2" />
      </label>
    </div>
  </fieldset>
  {#if errors.length}
    <ul data-testid="structure-input-errors" class="list-disc space-y-1 pl-5 text-sm text-red-600" aria-live="polite">
      {#each errors as error}<li>{error}</li>{/each}
    </ul>
  {:else if editorValid}
    <p data-testid="structure-input-valid" class="text-sm text-green-700">Molecule descriptions are valid. Local file contents and hardware limits must also pass before prediction.</p>
  {/if}
  {#each adapter.warnings as warning}<p class="text-sm text-amber-700">{warning}</p>{/each}
  {#if affinity}
    <p class="text-sm text-text-muted">Binding probability estimates how likely the molecules are to bind. Log10(IC50) is a separate strength estimate, using micromolar units; lower values predict stronger binding. Neither result proves an experimental effect.</p>
    <p class="text-sm text-text-muted">The installed model checks the molecule's atoms: more than 56 raises a warning; more than 128 stops prediction.</p>
  {/if}
  {#if model?.status !== 'installed'}
    <div class="rounded border border-border p-3 text-sm"><strong>Install required</strong><p>Install this AI Model in Dependencies to check local files and run a prediction.</p></div>
  {:else if !locked}
    <div class="flex flex-wrap gap-2">
      <Button variant="secondary" testId="structure-preflight" disabled={!canCheck} loading={checking} onclick={checkRun}>Check run</Button>
      <Button variant="primary" testId="structure-run" disabled={!canRun} loading={running} onclick={runPrediction}>Run</Button>
    </div>
    {#if gpuBusy}<p class="text-sm text-text-muted">Another prediction with this AI Model is using the GPU. This one can start when it finishes.</p>{/if}
    {#if preflight}
      <div class="rounded-lg border border-border bg-surface-2 p-3" data-testid="structure-estimate">
        <p class="mb-2 text-xs font-medium text-text-secondary">
          {preflight.estimate.accepted && preflight.estimate.evidence === 'measured'
            ? 'Run estimate from retained measurements'
            : 'This prediction is larger than anything measured'}
        </p>
        <div class="grid grid-cols-2 gap-2 text-xs md:grid-cols-6">
          <div><span class="text-text-subtle">Sequence length</span><p class="font-medium">{preflight.metrics.tokenCount.toLocaleString()}</p></div>
          <div><span class="text-text-subtle">Structures drawn</span><p class="font-medium">{preflight.metrics.outputItemCount.toLocaleString()}</p></div>
          {#if preflight.estimate.accepted && preflight.estimate.evidence === 'measured'}
            <div><span class="text-text-subtle">RAM</span><p class="font-medium">{fmtBytes(preflight.estimate.estimatedRamBytes)}</p></div>
            <div><span class="text-text-subtle">GPU memory</span><p class="font-medium">{preflight.estimate.estimatedVramBytes === null ? 'Not used' : fmtBytes(preflight.estimate.estimatedVramBytes)}</p></div>
            <div><span class="text-text-subtle">Time</span><p class="font-medium">{durationLabel(preflight.estimate.estimatedTimeMs)}</p></div>
            <div><span class="text-text-subtle">Output</span><p class="font-medium">{fmtBytes(preflight.estimate.estimatedOutputBytes)}</p></div>
          {:else if preflight.estimate.accepted}
            <div><span class="text-text-subtle">Longest measured so far</span><p class="font-medium">{preflight.estimate.maxValidatedTokenCount.toLocaleString()}</p></div>
            <div><span class="text-text-subtle">This computer has</span><p class="font-medium">{host.totalMemoryBytes === null ? 'Unknown' : fmtBytes(host.totalMemoryBytes)}</p></div>
          {/if}
        </div>
      </div>
    {/if}
    {#if beyondEvidence}
      <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <p>
          Nobody has measured a prediction this size on this kind of computer, so the memory and time
          it needs are unknown. It may work, it may be slow, or it may run out of GPU memory and stop.
          The result will record that this run went beyond measured evidence.
        </p>
        <label class="mt-2 flex items-center gap-2 font-medium">
          <input type="checkbox" data-testid="structure-accept-beyond-evidence" bind:checked={beyondEvidenceAccepted} />
          Run it anyway
        </label>
      </div>
    {/if}
    {#if preflightError}<div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{preflightError}</div>{/if}
  {/if}
</section>
