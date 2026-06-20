<script lang="ts">
  import type { ApiKeyValue } from '$lib/types/api-connection';

  interface Props {
    rows: ApiKeyValue[];
    keyPlaceholder?: string;
    valuePlaceholder?: string;
    disabled?: boolean;
    onchange: (rows: ApiKeyValue[]) => void;
  }

  let {
    rows,
    keyPlaceholder = 'Key',
    valuePlaceholder = 'Value',
    disabled = false,
    onchange,
  }: Props = $props();

  function update(index: number, patch: Partial<ApiKeyValue>) {
    const next = rows.map((r, i) => i === index ? { ...r, ...patch } : r);
    onchange(next);
  }

  function addRow() {
    onchange([...rows, { key: '', value: '', enabled: true }]);
  }

  function removeRow(index: number) {
    onchange(rows.filter((_, i) => i !== index));
  }
</script>

<div class="rounded-lg border border-border overflow-hidden">
  <!-- Header -->
  <div class="grid grid-cols-[20px_1fr_1fr_20px] gap-2 px-2 py-1.5 bg-surface border-b border-border">
    <span></span>
    <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{keyPlaceholder}</span>
    <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{valuePlaceholder}</span>
    <span></span>
  </div>

  <!-- Rows -->
  {#each rows as row, i}
    <div class="grid grid-cols-[20px_1fr_1fr_20px] gap-2 px-2 py-1 items-center border-b border-border/50 last:border-0
                {!row.enabled ? 'opacity-50' : ''}">
      <input
        type="checkbox"
        checked={row.enabled}
        onchange={(e) => update(i, { enabled: (e.target as HTMLInputElement).checked })}
        {disabled}
        class="h-3 w-3 rounded border-zinc-300 accent-brand"
      />
      <input
        type="text"
        value={row.key}
        oninput={(e) => update(i, { key: (e.target as HTMLInputElement).value })}
        placeholder={keyPlaceholder}
        {disabled}
        class="w-full text-xs font-mono bg-transparent outline-none text-zinc-800
               placeholder:text-zinc-300 focus:bg-brand/5 rounded px-1 py-0.5"
      />
      <input
        type="text"
        value={row.value}
        oninput={(e) => update(i, { value: (e.target as HTMLInputElement).value })}
        placeholder={valuePlaceholder}
        {disabled}
        class="w-full text-xs font-mono bg-transparent outline-none text-zinc-800
               placeholder:text-zinc-300 focus:bg-brand/5 rounded px-1 py-0.5"
      />
      <button
        type="button"
        onclick={() => removeRow(i)}
        {disabled}
        class="text-zinc-300 hover:text-red-400 transition-colors"
        aria-label="Remove row"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  {/each}

  <!-- Add row -->
  <button
    type="button"
    onclick={addRow}
    {disabled}
    class="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400
           hover:bg-zinc-50 hover:text-zinc-600 transition-colors"
  >
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    Add row
  </button>
</div>
