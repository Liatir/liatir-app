<script lang="ts">
  import Icon from '@iconify/svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import type { ApiParam } from '$lib/types/api-connection';
  import { emptyParam } from '$lib/types/api-connection';

  interface Props {
    rows: ApiParam[];
    disabled?: boolean;
    onchange: (rows: ApiParam[]) => void;
  }

  let { rows, disabled = false, onchange }: Props = $props();

  function update(i: number, patch: Partial<ApiParam>) {
    onchange(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function addRow() { onchange([...rows, emptyParam()]); }
  function removeRow(i: number) { onchange(rows.filter((_, idx) => idx !== i)); }
</script>

<div class="rounded-lg border border-border overflow-hidden text-xs">
  <!-- Header -->
  <div class="grid grid-cols-[18px_1fr_1fr_24px_72px_24px_18px] gap-2 px-2 py-1.5 bg-surface border-b border-border items-center">
    <span></span>
    <span class="text-[10px] font-semibold text-text-subtle uppercase tracking-wider">Key</span>
    <span class="text-[10px] font-semibold text-text-subtle uppercase tracking-wider">Value</span>
    <span class="text-[10px] font-semibold text-text-subtle text-center" title="Let the user or a pipeline provide this value when the call runs">Input</span>
    <span class="text-[10px] font-semibold text-text-subtle text-center" title="Where to send the value when it is not embedded in the request">In</span>
    <span class="text-[10px] font-semibold text-text-subtle text-center" title="Stop before sending when the value is empty">Req.</span>
    <span></span>
  </div>

  {#each rows as row, i (i)}
    <div class="grid grid-cols-[18px_1fr_1fr_24px_72px_24px_18px] gap-2 px-2 py-1 items-center border-b border-border/50 last:border-0 {!row.enabled ? 'opacity-50' : ''}">
      <input type="checkbox" checked={row.enabled} {disabled}
        onchange={(e) => update(i, { enabled: (e.target as HTMLInputElement).checked })}
        class="h-3 w-3 rounded border-border-2 accent-brand" />
      <input type="text" value={row.key} placeholder="key" {disabled}
        oninput={(e) => update(i, { key: (e.target as HTMLInputElement).value })}
        class="w-full font-mono bg-transparent outline-none text-text placeholder:text-text-faint focus:bg-brand/5 rounded px-1 py-0.5" />
      <input type="text" value={row.value} placeholder={row.exposedAsInput ? 'default value' : 'fixed value'} {disabled}
        oninput={(e) => update(i, { value: (e.target as HTMLInputElement).value })}
        class="w-full font-mono bg-transparent outline-none text-text placeholder:text-text-faint focus:bg-brand/5 rounded px-1 py-0.5" />
      <div class="flex justify-center">
        <input type="checkbox" checked={row.exposedAsInput} {disabled}
          onchange={(e) => update(i, { exposedAsInput: (e.target as HTMLInputElement).checked })}
          class="h-3 w-3 rounded border-border-2 accent-brand" />
      </div>
      <Select value={row.location}
        options={[{ value: 'query', label: 'URL' }, { value: 'body', label: 'Body' }]}
        onchange={(location) => update(i, { location: location as ApiParam['location'] })}
        class="w-[72px]" />
      <div class="flex justify-center">
        <input type="checkbox" checked={row.required} {disabled}
          onchange={(e) => update(i, { required: (e.target as HTMLInputElement).checked })}
          class="h-3 w-3 rounded border-border-2 accent-brand" />
      </div>
      <button type="button" onclick={() => removeRow(i)} {disabled} aria-label="Remove parameter"
        class="text-text-faint hover:text-red-400 transition-colors">
        <Icon icon="lucide:x" width="11" height="11" />
      </button>
    </div>
  {/each}

  <button type="button" onclick={addRow} {disabled}
    class="w-full flex items-center gap-1.5 px-3 py-1.5 text-text-subtle hover:bg-surface-2 hover:text-text-secondary transition-colors">
    <Icon icon="lucide:plus" width="11" height="11" />
    Add parameter
  </button>
</div>
