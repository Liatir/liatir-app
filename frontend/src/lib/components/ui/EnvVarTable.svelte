<script lang="ts">
  import type { WorkspaceEnvVar } from '$lib/types/workspace';
  import Select from '$lib/components/ui/Select.svelte';

  interface Props {
    vars: WorkspaceEnvVar[];
    onchange: (vars: WorkspaceEnvVar[]) => void;
  }

  let { vars, onchange }: Props = $props();
  const typeOptions = [
    { value: 'string', label: 'string' },
    { value: 'number', label: 'number' },
    { value: 'boolean', label: 'boolean' },
  ];

  function update(index: number, patch: Partial<WorkspaceEnvVar>) {
    onchange(vars.map((v, i) => i === index ? { ...v, ...patch } : v));
  }

  function addRow() {
    onchange([...vars, { key: '', value: '', type: 'string', enabled: true }]);
  }

  function removeRow(index: number) {
    onchange(vars.filter((_, i) => i !== index));
  }

  function onTypeChange(index: number, type: WorkspaceEnvVar['type']) {
    const current = vars[index];
    let value = current.value;
    if (type === 'boolean' && value !== 'true' && value !== 'false') value = 'true';
    if (type === 'number' && isNaN(Number(value))) value = '0';
    update(index, { type, value });
  }
</script>

<div class="rounded-lg border border-border overflow-hidden">
  <!-- Header -->
  <div class="grid grid-cols-[20px_80px_1fr_1fr_20px] gap-2 px-2 py-1.5 bg-surface border-b border-border">
    <span></span>
    <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Type</span>
    <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Key</span>
    <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Value</span>
    <span></span>
  </div>

  <!-- Rows -->
  {#each vars as v, i}
    <div class="grid grid-cols-[20px_80px_1fr_1fr_20px] gap-2 px-2 py-1 items-center border-b border-border/50 last:border-0
                {!v.enabled ? 'opacity-50' : ''}">
      <input
        type="checkbox"
        checked={v.enabled}
        onchange={(e) => update(i, { enabled: (e.target as HTMLInputElement).checked })}
        class="h-3 w-3 rounded border-zinc-300 accent-brand"
      />

      <!-- Type selector -->
      <Select
        value={v.type}
        options={typeOptions}
        onchange={(value) => onTypeChange(i, value as WorkspaceEnvVar['type'])}
        class="w-full"
        buttonClass="rounded border-border bg-transparent px-1 py-0.5 text-xs text-zinc-500 shadow-none"
      />

      <!-- Key -->
      <input
        type="text"
        value={v.key}
        oninput={(e) => update(i, { key: (e.target as HTMLInputElement).value })}
        placeholder="KEY_NAME"
        class="w-full text-xs font-mono bg-transparent outline-none text-zinc-800
               placeholder:text-zinc-300 focus:bg-brand/5 rounded px-1 py-0.5"
      />

      <!-- Value -->
      {#if v.type === 'boolean'}
        <button
          type="button"
          onclick={() => update(i, { value: v.value === 'true' ? 'false' : 'true' })}
          class="flex items-center gap-1.5 text-xs font-mono px-1 py-0.5 rounded
                 {v.value === 'true' ? 'text-emerald-600' : 'text-zinc-400'}
                 hover:bg-surface-2 transition-colors text-left"
        >
          <span class="h-3 w-3 rounded-full border flex items-center justify-center
                       {v.value === 'true' ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-300'}">
            {#if v.value === 'true'}
              <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            {/if}
          </span>
          {v.value === 'true' ? 'true' : 'false'}
        </button>
      {:else}
        <input
          type={v.type === 'number' ? 'number' : 'text'}
          value={v.value}
          oninput={(e) => update(i, { value: (e.target as HTMLInputElement).value })}
          placeholder={v.type === 'number' ? '0' : 'value'}
          class="w-full text-xs font-mono bg-transparent outline-none text-zinc-800
                 placeholder:text-zinc-300 focus:bg-brand/5 rounded px-1 py-0.5"
        />
      {/if}

      <button
        type="button"
        onclick={() => removeRow(i)}
        class="text-zinc-300 hover:text-red-400 transition-colors"
        aria-label="Remove"
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
    class="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400
           hover:bg-zinc-50 hover:text-zinc-600 transition-colors"
  >
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    Add variable
  </button>
</div>
