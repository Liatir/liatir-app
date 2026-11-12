<!--
  Declares a Python Script's inputs or outputs: the contract Liatir checks on every run and that
  pipeline connections are typed by. New fields start without a name; the page refuses to save until
  each has a valid, unique one. Changing a field's kind drops its default, which may not fit.
-->
<script lang="ts">
  import {
    LIATIR_SCRIPT_INPUT_TYPES,
    LIATIR_SCRIPT_OUTPUT_TYPES,
    type LiatirFieldSchema,
  } from '@liatir/core';
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import LabelWithInfo from '$lib/components/ui/LabelWithInfo.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { FIELD_INPUT_CLASS } from '$lib/components/ui/field-styles';
  import { contractNameProblem, type ScriptContractRow } from '$lib/tools/script-contract';

  let { rows, output = false, disabled = false, onchange }: {
    rows: ScriptContractRow[];
    output?: boolean;
    disabled?: boolean;
    onchange: (rows: ScriptContractRow[]) => void;
  } = $props();

  const kind = $derived(output ? 'output' : 'input');
  const KIND_LABELS: Record<string, string> = {
    string: 'Text', number: 'Number', boolean: 'Yes / No', file: 'File', json: 'Structured data', stats: 'Summary numbers',
  };
  const kindOptions = $derived((output ? LIATIR_SCRIPT_OUTPUT_TYPES : LIATIR_SCRIPT_INPUT_TYPES)
    .map((type) => ({ value: type, label: KIND_LABELS[type] })));

  function update(id: string, change: Partial<ScriptContractRow>) {
    onchange(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  }

  function patchField(row: ScriptContractRow, field: Partial<LiatirFieldSchema>) {
    update(row.id, { field: { ...row.field, ...field } });
  }

  function changeKind(row: ScriptContractRow, type: string) {
    const { default: _default, accept: _accept, ...rest } = row.field;
    update(row.id, { field: { ...rest, type: type as LiatirFieldSchema['type'] } });
  }

  function add() {
    onchange([...rows, { id: crypto.randomUUID(), name: '', field: { type: 'string', required: true } }]);
  }
</script>

<Card class="space-y-3 p-4">
  {#if output}
    <LabelWithInfo
      text="Outputs"
      info={'The results your script gives back. Give each one a short name, then end your code by returning them with those names, for example: return {"my_result": 42}. Liatir checks that every declared result is there and of the right kind before saving it or passing it to the next step of a pipeline.'}
    />
  {:else}
    <LabelWithInfo
      text="Inputs"
      info={'The information your script needs to work: a number, a piece of text, a yes/no choice or a file. Give each one a short name, then use that name in your code, for example: ctx.input["my_variable"]. Liatir checks every value before the script starts.'}
    />
  {/if}

  {#each rows as row (row.id)}
    {@const problem = row.name.trim() ? contractNameProblem(row, rows, kind) : null}
    <div class="space-y-2 rounded-lg border border-border bg-surface-2/40 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <input
          aria-label="Name used in the code"
          class="{FIELD_INPUT_CLASS} !w-44 font-mono {problem ? '!border-red-500' : ''}"
          placeholder={output ? 'e.g. my_result' : 'e.g. my_variable'}
          value={row.name}
          {disabled}
          oninput={(event) => update(row.id, { name: event.currentTarget.value })}
        />
        <Select value={row.field.type} options={kindOptions} {disabled} onchange={(type) => changeKind(row, type)} />
        <label class="flex items-center gap-1.5 text-xs text-text-secondary" title="A required {kind} must always have a value.">
          <input type="checkbox" checked={row.field.required ?? false} {disabled}
            onchange={(event) => patchField(row, { required: event.currentTarget.checked })} />
          Required
        </label>
        <button type="button" class="ml-auto text-text-faint transition-colors hover:text-red-500 disabled:opacity-40"
          aria-label="Remove this {kind}" {disabled} onclick={() => onchange(rows.filter((other) => other.id !== row.id))}>
          <Icon icon="lucide:x" width="14" height="14" />
        </button>
      </div>
      {#if problem}<p class="text-xs text-red-500">{problem}</p>{/if}
      <input
        aria-label="Label shown to people"
        placeholder="Label shown to people (optional), e.g. Number of samples"
        class={FIELD_INPUT_CLASS}
        value={row.field.label ?? ''}
        {disabled}
        onchange={(event) => patchField(row, { label: event.currentTarget.value.trim() || undefined })}
      />
      {#if row.field.type === 'file' && !output}
        <input
          aria-label="Accepted file types"
          placeholder="Accepted file types (optional), e.g. csv, txt"
          class={FIELD_INPUT_CLASS}
          value={(row.field.accept ?? []).join(', ')}
          {disabled}
          onchange={(event) => patchField(row, { accept: event.currentTarget.value.split(',').map((value) => value.trim()).filter(Boolean) })}
        />
      {/if}
    </div>
  {:else}
    <p class="text-xs text-text-muted">
      {output ? 'No outputs yet: the script returns nothing.' : 'No inputs yet: the script needs no information to start.'}
    </p>
  {/each}
  <Button size="sm" variant="secondary" {disabled} onclick={add}>Add {kind}</Button>
</Card>
