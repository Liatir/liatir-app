<script lang="ts">
  import Icon from '@iconify/svelte';
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
  <div class="grid grid-cols-[18px_1fr_1fr_auto_auto_auto_18px] gap-2 px-2 py-1.5 bg-surface border-b border-border items-center">
    <span></span>
    <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Key</span>
    <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Value</span>
    <span class="text-[10px] font-semibold text-zinc-400 w-12 text-center" title="Private: value fixed server-side, not exposed as an input">Private</span>
    <span class="text-[10px] font-semibold text-zinc-400 w-14 text-center" title="Send in the query string (otherwise in the body)">Querystr.</span>
    <span class="text-[10px] font-semibold text-zinc-400 w-12 text-center" title="May be left blank">Optional</span>
    <span></span>
  </div>

  {#each rows as row, i (i)}
    <div class="grid grid-cols-[18px_1fr_1fr_auto_auto_auto_18px] gap-2 px-2 py-1 items-center border-b border-border/50 last:border-0 {!row.enabled ? 'opacity-50' : ''}">
      <input type="checkbox" checked={row.enabled} {disabled}
        onchange={(e) => update(i, { enabled: (e.target as HTMLInputElement).checked })}
        class="h-3 w-3 rounded border-zinc-300 accent-brand" />
      <input type="text" value={row.key} placeholder="key" {disabled}
        oninput={(e) => update(i, { key: (e.target as HTMLInputElement).value })}
        class="w-full font-mono bg-transparent outline-none text-zinc-800 placeholder:text-zinc-300 focus:bg-brand/5 rounded px-1 py-0.5" />
      <input type="text" value={row.value} placeholder={row.private ? 'value' : 'default / input'} {disabled}
        oninput={(e) => update(i, { value: (e.target as HTMLInputElement).value })}
        class="w-full font-mono bg-transparent outline-none text-zinc-800 placeholder:text-zinc-300 focus:bg-brand/5 rounded px-1 py-0.5" />
      <div class="w-12 flex justify-center">
        <input type="checkbox" checked={row.private} {disabled}
          onchange={(e) => update(i, { private: (e.target as HTMLInputElement).checked })}
          class="h-3 w-3 rounded border-zinc-300 accent-brand" />
      </div>
      <div class="w-14 flex justify-center">
        <input type="checkbox" checked={row.querystring} {disabled}
          onchange={(e) => update(i, { querystring: (e.target as HTMLInputElement).checked })}
          class="h-3 w-3 rounded border-zinc-300 accent-brand" />
      </div>
      <div class="w-12 flex justify-center">
        <input type="checkbox" checked={row.optional} {disabled}
          onchange={(e) => update(i, { optional: (e.target as HTMLInputElement).checked })}
          class="h-3 w-3 rounded border-zinc-300 accent-brand" />
      </div>
      <button type="button" onclick={() => removeRow(i)} {disabled} aria-label="Remove parameter"
        class="text-zinc-300 hover:text-red-400 transition-colors">
        <Icon icon="lucide:x" width="11" height="11" />
      </button>
    </div>
  {/each}

  <button type="button" onclick={addRow} {disabled}
    class="w-full flex items-center gap-1.5 px-3 py-1.5 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-colors">
    <Icon icon="lucide:plus" width="11" height="11" />
    Add parameter
  </button>
</div>
