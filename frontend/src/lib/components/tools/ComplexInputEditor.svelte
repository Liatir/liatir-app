<script lang="ts">
  import {
    parseLiatirComplexSpecJson,
    parseLiatirComplexSpecDraftJson,
    type LiatirComplexEntity,
    type LiatirComplexSpec,
    type LiatirStructureMsaSelection,
  } from '@liatir/core';
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import { FIELD_INPUT_CLASS, FIELD_LABEL_CLASS } from '$lib/components/ui/field-styles';
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
  const TYPE_LABELS: Record<LiatirComplexEntity['type'], string> = { protein: 'Protein', dna: 'DNA', rna: 'RNA', ligand: 'Small molecule' };
  const ADD_BUTTONS: [LiatirComplexEntity['type'], string][] = [['protein', 'Add protein'], ['dna', 'Add DNA'], ['rna', 'Add RNA'], ['ligand', 'Add small molecule']];
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
    <div>
      <h2 class="text-sm font-semibold text-text">Molecules</h2>
      <p class="mt-0.5 text-xs text-text-muted">Add the molecules you want to study together. Nothing is sent to an alignment server.</p>
    </div>
    <Button variant="ghost" size="sm" testId="complex-editor-mode" onclick={switchMode}
      disabled={disabled || (advanced && !parseLiatirComplexSpecDraftJson(json).spec)}>
      <Icon icon={advanced ? 'lucide:list' : 'lucide:braces'} width="14" />
      {advanced ? 'Use simple editor' : 'Edit advanced JSON'}
    </Button>
  </div>
  {#if advanced}
    <label class="block">
      <span class={FIELD_LABEL_CLASS}>Advanced complex input (JSON, a structured text format)</span>
      <textarea data-testid="complex-advanced-json" bind:value={json} oninput={updateAdvanced} {disabled} rows="18" spellcheck="false" class="{FIELD_INPUT_CLASS} font-mono text-xs" aria-invalid={!valid}></textarea>
    </label>
    {#if errors.length}
      <ul role="alert" class="list-disc space-y-1 rounded-lg border border-red-200 bg-red-50 py-2 pl-7 pr-3 text-xs text-red-700">
        {#each errors as error}<li>{error}</li>{/each}
      </ul>
    {/if}
  {:else}
    {#each spec.entities as entity, index}
      <fieldset {disabled} aria-label="Molecule {index + 1}" class="space-y-3 rounded-xl border border-border bg-surface-2/40 p-4">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-medium text-text">Molecule {index + 1} <span class="font-normal text-text-muted">· {TYPE_LABELS[entity.type]}</span></p>
          <Button variant="ghost" size="sm" onclick={() => removeEntity(index)}><Icon icon="lucide:trash-2" width="14" />Remove</Button>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
          <label class="block"><span class={FIELD_LABEL_CLASS}>Identifier</span>
            <input bind:value={entity.id} onchange={reconcileMsa} class={FIELD_INPUT_CLASS} />
          </label>
          <label class="block"><span class={FIELD_LABEL_CLASS}>Number of copies</span>
            <input data-testid="complex-copies" type="number" min="1" step="1" value={entity.copies ?? 1} oninput={(event) => { entity.copies = Number(event.currentTarget.value); }} class={FIELD_INPUT_CLASS} />
          </label>
        </div>
        {#if entity.type === 'ligand'}
          {#if entity.ccdCode !== undefined}
            <label class="block"><span class={FIELD_LABEL_CLASS}>Chemical dictionary code</span>
              <input bind:value={entity.ccdCode} class={FIELD_INPUT_CLASS} />
            </label>
          {:else}
            <label class="block"><span class={FIELD_LABEL_CLASS}>SMILES (a text description of the molecule's atoms and bonds)</span>
              <input bind:value={entity.smiles} spellcheck="false" class="{FIELD_INPUT_CLASS} font-mono" />
            </label>
          {/if}
        {:else}
          <label class="block"><span class={FIELD_LABEL_CLASS}>Sequence</span>
            <textarea data-testid="complex-sequence" bind:value={entity.sequence} rows="3" spellcheck="false" class="{FIELD_INPUT_CLASS} font-mono"></textarea>
          </label>
          {#if entity.type === 'protein'}
            <div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <FilePickerPopup files={alignmentFiles} value={entity.msa?.path ?? ''} {disabled}
                label="Local alignment" info="An A3M file compares this protein with similar sequences."
                emptyText="No A3M alignments in Data. Add a local file in Data to select it here."
                onchange={(path) => setMsa(index, path)} />
              {#if entity.msa}
                <Button variant="ghost" size="sm" {disabled} onclick={() => setMsa(index, '')}>Clear</Button>
              {/if}
            </div>
            {#each (spec.templates ?? []).filter((template) => template.entityId === entity.id) as template}
              <div class="space-y-2 rounded-lg border border-border p-3">
                <div class="flex items-center justify-between gap-3">
                  <p class="min-w-0 break-all text-xs text-text-secondary">Template: {template.path.split(/[\\/]/u).pop()}</p>
                  <Button variant="ghost" size="sm" {disabled} onclick={() => removeTemplate(template.id)}>Remove</Button>
                </div>
                <label class="block"><span class={FIELD_LABEL_CLASS}>Chain in the template (optional molecule identifier)</span>
                  <input bind:value={template.chainId} class={FIELD_INPUT_CLASS} />
                </label>
              </div>
            {/each}
            <FilePickerPopup files={templateFiles} value="" {disabled}
              label="Add a local template (optional)"
              info="A known structure or a local template-search file can guide prediction. Supported formats depend on the selected model."
              emptyText="No template files in Data."
              onchange={(path) => addTemplate(entity.id, path)} />
          {/if}
        {/if}
      </fieldset>
    {/each}
    <div class="flex flex-wrap gap-2">
      {#each ADD_BUTTONS as [type, label]}
        <Button variant="secondary" size="sm" {disabled} onclick={() => addEntity(type)}><Icon icon="lucide:plus" width="14" />{label}</Button>
      {/each}
    </div>
  {/if}
  {#each spec.entities.filter((entity) => entity.type === 'protein' && !entity.msa) as entity}
    <label class="flex items-start gap-2 text-xs text-text-secondary">
      <input data-testid="complex-single-sequence" type="checkbox" class="mt-0.5 accent-brand" {disabled} checked={msa.singleSequenceEntityIds.includes(entity.id)} onchange={(event) => singleSequence(entity.id, event.currentTarget.checked)} />
      Predict {entity.id} using its sequence alone, without an alignment
    </label>
  {/each}
  {#if msa.singleSequenceEntityIds.length}
    <label class="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <input data-testid="complex-accuracy-acceptance" type="checkbox" class="mt-0.5 accent-brand" {disabled} bind:checked={msa.lowerAccuracyAccepted} />
      I understand that predicting without an alignment can be less accurate.
    </label>
  {/if}
</section>
