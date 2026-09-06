<script lang="ts">
  import {
    parseLiatirComplexSpecJson,
    parseLiatirComplexSpecDraftJson,
    type LiatirComplexEntity,
    type LiatirComplexSpec,
    type LiatirStructureMsaSelection,
  } from '@liatir/core';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import type { DataFile } from '$lib/stores/dataFiles.svelte';

  // The parent owns this draft per tool instance; no global state or running-job state lives here.
  let {
    spec = $bindable(),
    msa = $bindable(),
    valid = $bindable(true),
    advanced = $bindable(false),
    json = $bindable(''),
    disabled = false,
    files = [],
  }: {
    spec: LiatirComplexSpec;
    msa: LiatirStructureMsaSelection;
    valid?: boolean;
    advanced?: boolean;
    json?: string;
    disabled?: boolean;
    files?: DataFile[];
  } = $props();
  let errors = $state<string[]>([]);
  const alignmentFiles = $derived(files.filter((file) => /\.a3m$/iu.test(file.path)));
  const templateFiles = $derived(files.filter((file) => /\.(?:pdb|cif|mmcif|hhr|a3m)$/iu.test(file.path)));

  $effect(() => {
    const parsed = advanced ? parseLiatirComplexSpecJson(json) : null;
    valid = parsed?.valid ?? true;
    errors = parsed?.errors ?? [];
  });

  function switchMode() {
    if (!advanced) {
      json = JSON.stringify(spec, null, 2);
      updateAdvanced();
    }
    advanced = !advanced;
  }

  function updateAdvanced() {
    const parsed = parseLiatirComplexSpecDraftJson(json);
    valid = parsed.valid;
    errors = parsed.errors;
    if (parsed.spec) {
      spec = parsed.spec;
      reconcileMsa();
    }
  }

  function reconcileMsa() {
    const eligible = new Set(spec.entities.filter((entity) => entity.type === 'protein' && !entity.msa).map((entity) => entity.id));
    msa = { ...msa, singleSequenceEntityIds: msa.singleSequenceEntityIds.filter((id) => eligible.has(id)) };
  }

  function addEntity(type: LiatirComplexEntity['type']) {
    let index = 1;
    while (spec.entities.some((entity) => entity.id === `molecule${index}`)) index++;
    const id = `molecule${index}`;
    const entity: LiatirComplexEntity = type === 'ligand'
      ? { id, type, smiles: '' }
      : { id, type, sequence: '' };
    spec = { ...spec, entities: [...spec.entities, entity] };
  }

  function removeEntity(index: number) {
    spec = { ...spec, entities: spec.entities.filter((_, i) => i !== index) };
    // Keep constraints/templates: silently removing scientific instructions would change the request.
    // Their now-missing references are reported by the parent's request validation.
    reconcileMsa();
  }

  function setMsa(index: number, path: string) {
    const entity = spec.entities[index];
    if (entity.type !== 'protein') return;
    const { msa: previousMsa, ...protein } = entity;
    spec = { ...spec, entities: spec.entities.map((item, i) => i === index
      ? { ...protein, ...(path.trim() ? { msa: { format: 'a3m' as const, path } } : {}) }
      : item) };
    reconcileMsa();
  }

  function singleSequence(id: string, selected: boolean) {
    msa = { ...msa, singleSequenceEntityIds: selected
      ? [...new Set([...msa.singleSequenceEntityIds, id])]
      : msa.singleSequenceEntityIds.filter((item) => item !== id) };
  }

  function addTemplate(entityId: string, path: string) {
    if (!path) return;
    const extension = path.split('.').pop()?.toLowerCase();
    const format = extension === 'pdb' ? 'pdb' : extension === 'hhr' ? 'hhr' : extension === 'a3m' ? 'a3m' : 'mmcif';
    const templates = spec.templates ?? [];
    let index = 1;
    while (templates.some((template) => template.id === `template${index}`)) index++;
    spec = { ...spec, templates: [...templates, { id: `template${index}`, entityId, path, format }] };
  }

  function removeTemplate(id: string) {
    spec = { ...spec, templates: (spec.templates ?? []).filter((template) => template.id !== id) };
  }
</script>

<section aria-label="Molecules in this prediction" class="space-y-4">
  <div class="flex items-center justify-between gap-3">
    <h2 class="text-lg font-semibold">Molecules</h2>
    <button type="button" data-testid="complex-editor-mode" onclick={switchMode} disabled={disabled || (advanced && !parseLiatirComplexSpecDraftJson(json).spec)} class="text-sm underline">
      {advanced ? 'Use simple editor' : 'Edit advanced JSON'}
    </button>
  </div>
  <p class="text-sm opacity-75">Add the molecules you want to study together. Nothing is sent to an alignment server.</p>
  {#if advanced}
    <label class="block space-y-1">
      <span>Advanced complex input (JSON, a structured text format)</span>
      <textarea data-testid="complex-advanced-json" bind:value={json} oninput={updateAdvanced} {disabled} rows="18" spellcheck="false" class="w-full rounded border bg-transparent p-3 font-mono text-sm" aria-invalid={!valid}></textarea>
    </label>
    {#if errors.length}
      <ul role="alert" class="list-disc pl-5 text-sm text-red-500">
        {#each errors as error}<li>{error}</li>{/each}
      </ul>
    {/if}
  {:else}
    {#each spec.entities as entity, index}
      <fieldset {disabled} class="space-y-3 rounded border p-4">
        <legend class="px-1">Molecule {index + 1} · {entity.type === 'ligand' ? 'Small molecule' : entity.type.toUpperCase()}</legend>
        <label class="block">Identifier
          <input bind:value={entity.id} onchange={reconcileMsa} class="block w-full rounded border bg-transparent p-2" />
        </label>
        <label class="block">Number of copies
          <input data-testid="complex-copies" type="number" min="1" step="1" value={entity.copies ?? 1} oninput={(event) => { entity.copies = Number(event.currentTarget.value); }} class="block w-full rounded border bg-transparent p-2" />
        </label>
        {#if entity.type === 'ligand'}
          {#if entity.ccdCode !== undefined}
            <label class="block">Chemical dictionary code
              <input bind:value={entity.ccdCode} class="block w-full rounded border bg-transparent p-2" />
            </label>
          {:else}
            <label class="block">SMILES (a text description of the molecule's atoms and bonds)
              <input bind:value={entity.smiles} spellcheck="false" class="block w-full rounded border bg-transparent p-2" />
            </label>
          {/if}
        {:else}
          <label class="block">Sequence
            <textarea data-testid="complex-sequence" bind:value={entity.sequence} rows="3" spellcheck="false" class="block w-full rounded border bg-transparent p-2 font-mono"></textarea>
          </label>
          {#if entity.type === 'protein'}
            <FilePickerPopup files={alignmentFiles} value={entity.msa?.path ?? ''} {disabled}
              label="Local alignment" info="An A3M file compares this protein with similar sequences."
              emptyText="No A3M alignments in Data. Add a local file in Data to select it here."
              onchange={(path) => setMsa(index, path)} />
            {#if entity.msa}
              <button type="button" onclick={() => setMsa(index, '')} class="text-sm underline">Remove alignment</button>
            {/if}
            {#each (spec.templates ?? []).filter((template) => template.entityId === entity.id) as template}
              <div class="space-y-2 rounded border p-2">
                <p class="break-all text-sm">Template: {template.path.split(/[\\/]/u).pop()}</p>
                <label class="block text-sm">Chain in the template (optional molecule identifier)
                  <input bind:value={template.chainId} class="block w-full rounded border bg-transparent p-2" />
                </label>
                <button type="button" onclick={() => removeTemplate(template.id)} class="text-sm underline">Remove template</button>
              </div>
            {/each}
            <FilePickerPopup files={templateFiles} value="" {disabled}
              label="Add a local template (optional)"
              info="A known structure or a local template-search file can guide prediction. Supported formats depend on the selected model."
              emptyText="No template files in Data."
              onchange={(path) => addTemplate(entity.id, path)} />
          {/if}
        {/if}
        <button type="button" onclick={() => removeEntity(index)} class="text-sm underline">Remove molecule</button>
      </fieldset>
    {/each}
    <div class="flex flex-wrap gap-3">
      <button type="button" {disabled} onclick={() => addEntity('protein')}>Add protein</button>
      <button type="button" {disabled} onclick={() => addEntity('dna')}>Add DNA</button>
      <button type="button" {disabled} onclick={() => addEntity('rna')}>Add RNA</button>
      <button type="button" {disabled} onclick={() => addEntity('ligand')}>Add small molecule</button>
    </div>
  {/if}
  {#each spec.entities.filter((entity) => entity.type === 'protein' && !entity.msa) as entity}
    <label class="flex items-start gap-2 text-sm">
      <input data-testid="complex-single-sequence" type="checkbox" {disabled} checked={msa.singleSequenceEntityIds.includes(entity.id)} onchange={(event) => singleSequence(entity.id, event.currentTarget.checked)} />
      Predict {entity.id} using its sequence alone, without an alignment
    </label>
  {/each}
  {#if msa.singleSequenceEntityIds.length}
    <label class="flex items-start gap-2 rounded border p-3 text-sm">
      <input data-testid="complex-accuracy-acceptance" type="checkbox" {disabled} bind:checked={msa.lowerAccuracyAccepted} />
      I understand that predicting without an alignment can be less accurate.
    </label>
  {/if}
</section>
