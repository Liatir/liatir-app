<script lang="ts">
  import { untrack } from 'svelte';
  import {
    BOLTZ_2_MODEL_ID,
    PROTEIN_LIGAND_AFFINITY_TOOL_ID,
    adaptBoltz2Input,
    adaptProtenixInput,
    parseLiatirComplexSpecDraftJson,
    validateProteinLigandAffinityComplex,
    type LiatirAIModelRecord,
    type LiatirStructurePredictionRequest,
    type LiatirStructureToolDraft,
  } from '@liatir/core';
  import ComplexInputEditor from './ComplexInputEditor.svelte';
  import type { DataFile } from '$lib/stores/dataFiles.svelte';

  let { initial, models, files, onchange }: {
    initial: LiatirStructureToolDraft;
    models: LiatirAIModelRecord[];
    files: DataFile[];
    onchange: (draft: LiatirStructureToolDraft) => void;
  } = $props();
  // Mounted with a draft-ID key. A later selection cannot mutate this draft's async work.
  let draft = $state(untrack(() => structuredClone($state.snapshot(initial))));
  let spec = $state(untrack(() => parseLiatirComplexSpecDraftJson(initial.specJson).spec!));
  let editorValid = $state(true);
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
  const locked = $derived(draft.executionRunId !== null);

  $effect(() => {
    const snapshot = { ...$state.snapshot(draft), specJson: JSON.stringify(spec) };
    untrack(() => onchange(snapshot));
  });
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
  {:else}
    <div class="rounded border border-border p-3 text-sm">Prediction requires measured hardware limits for this exact model package. This candidate is still being validated.</div>
  {/if}
</section>
