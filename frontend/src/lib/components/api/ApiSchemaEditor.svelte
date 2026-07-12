<!--
	Editor for an API Connector response schema.

	The user declares what a request returns — field names, types, nesting — and that declaration is what
	turns an opaque JSON blob into typed outputs a pipeline node can be wired from. Without it, an API
	response could not be connected to anything downstream.

	**Recursive**: it imports itself as `Self` and renders a nested editor for any `object` or `array` field,
	so a schema of arbitrary depth is described by one component rather than by a fixed number of levels.
	`depth` exists only for indentation.

	The type labels are deliberately non-technical — "text", "yes/no", "list" — because the people describing
	an API response here are biologists, not developers.
-->
<script lang="ts">
  import Self from './ApiSchemaEditor.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import Icon from '@iconify/svelte';
  import type { ApiOutputSchemaField, ApiFieldType } from '$lib/types/api-connection';

  interface Props {
    schema: Record<string, ApiOutputSchemaField>;
    disabled?: boolean;
    /** Nesting level — used for indentation only. */
    depth?: number;
    onchange: (schema: Record<string, ApiOutputSchemaField>) => void;
  }

  let { schema, disabled = false, depth = 0, onchange }: Props = $props();

  const TYPES: { value: ApiFieldType; label: string }[] = [
    { value: 'string', label: 'text' },
    { value: 'number', label: 'number' },
    { value: 'boolean', label: 'yes/no' },
    { value: 'date', label: 'date' },
    { value: 'object', label: 'object' },
    { value: 'array', label: 'list' },
  ];

  const entries = $derived(Object.entries(schema));

  // Every mutation rebuilds the schema and hands it up via `onchange` — this component owns no state of its
  // own. That is what lets a nested editor's change propagate cleanly to the top.
  function setField(key: string, field: ApiOutputSchemaField) {
    onchange({ ...schema, [key]: field });
  }
  /**
   * Renames a field, preserving key order.
   *
   * The object is rebuilt in place rather than delete-and-reinsert, because the latter would move the
   * renamed field to the end and reshuffle the form under the user's cursor. A rename onto an existing name
   * is refused, since that would silently destroy the other field.
   */
  function rename(oldKey: string, newKey: string) {
    newKey = newKey.trim();
    if (!newKey || newKey === oldKey || schema[newKey]) return;
    const next: Record<string, ApiOutputSchemaField> = {};
    for (const [k, v] of Object.entries(schema)) next[k === oldKey ? newKey : k] = (k === oldKey ? { ...v, label: newKey } : v);
    onchange(next);
  }
  function remove(key: string) {
    const next = { ...schema };
    delete next[key];
    onchange(next);
  }
  /** Adds a field under a free name (`field`, `field1`, …), so a new one never collides with an existing key. */
  function addField() {
    let key = 'field', n = 1;
    while (schema[key]) key = `field${n++}`;
    setField(key, { label: key, path: key, type: 'string' });
  }
  function changeType(key: string, type: ApiFieldType) {
    const f = schema[key];
    const next: ApiOutputSchemaField = { ...f, type };
    if (type === 'object' && !next.children) next.children = {};
    if (type === 'array' && !next.items) next.items = { label: 'item', path: f.path ? `${f.path}.0` : '0', type: 'string' };
    setField(key, next);
  }
  function changeItemType(key: string, type: ApiFieldType) {
    const f = schema[key];
    const items = { ...(f.items ?? { label: 'item', path: '', type: 'string' as ApiFieldType }), type };
    if (type === 'object' && !items.children) items.children = {};
    setField(key, { ...f, items });
  }
</script>

<div class="space-y-1" style="margin-left: {depth > 0 ? 12 : 0}px">
  {#each entries as [key, field] (key)}
    <div class="rounded border border-border/70 bg-white">
      <div class="flex items-center gap-2 px-2 py-1">
        <Icon
          icon={field.type === 'object' ? 'lucide:braces' : field.type === 'array' ? 'lucide:brackets' : 'lucide:dot'}
          width="12" height="12" class="text-zinc-400 shrink-0" />
        <input type="text" value={key} {disabled}
          onblur={(e) => rename(key, (e.target as HTMLInputElement).value)}
          class="flex-1 min-w-0 text-xs font-mono text-zinc-800 bg-transparent outline-none focus:bg-brand/5 rounded px-1 py-0.5" />
        <Select value={field.type} options={TYPES} onchange={(t) => changeType(key, t as ApiFieldType)} class="w-24 shrink-0" />
        {#if field.type === 'array'}
          <span class="text-[10px] text-zinc-400">of</span>
          <Select value={field.items?.type ?? 'string'} options={TYPES.filter(t => t.value !== 'array')}
            onchange={(t) => changeItemType(key, t as ApiFieldType)} class="w-24 shrink-0" />
        {/if}
        <button type="button" onclick={() => remove(key)} {disabled} aria-label="Remove field"
          class="text-zinc-300 hover:text-red-400 transition-colors shrink-0">
          <Icon icon="lucide:x" width="11" height="11" />
        </button>
      </div>

      {#if field.type === 'object' && field.children}
        <div class="px-2 pb-1.5">
          <Self schema={field.children} {disabled} depth={depth + 1}
            onchange={(c) => setField(key, { ...field, children: c })} />
        </div>
      {/if}
      {#if field.type === 'array' && field.items?.type === 'object' && field.items.children}
        <div class="px-2 pb-1.5">
          <Self schema={field.items.children} {disabled} depth={depth + 1}
            onchange={(c) => setField(key, { ...field, items: { ...field.items!, children: c } })} />
        </div>
      {/if}
    </div>
  {/each}

  <button type="button" onclick={addField} {disabled}
    class="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-brand transition-colors px-1 py-0.5">
    <Icon icon="lucide:plus" width="11" height="11" />
    Add field
  </button>
</div>
