<script lang="ts">
  import { onMount } from 'svelte';

  export interface SelectOption {
    value: string;
    label: string;
  }

  interface Props {
    value: string;
    options: SelectOption[];
    onchange: (value: string) => void;
    class?: string;
  }

  let { value, options, onchange, class: className = '' }: Props = $props();

  let open = $state(false);
  let triggerEl: HTMLButtonElement | null = $state(null);
  let listboxEl: HTMLDivElement | null = $state(null);
  let pos = $state({ top: 0, left: 0, width: 0, bottom: 0, above: false });

  const selectedLabel = $derived(options.find(o => o.value === value)?.label ?? '');

  function openMenu() {
    if (!triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < 180 && rect.top > 180;
    const width = Math.max(rect.width, 140);
    const left = rect.left + width > window.innerWidth
      ? Math.max(0, rect.right - width)
      : rect.left;
    pos = {
      top: rect.bottom + 4,
      left,
      width,
      bottom: window.innerHeight - rect.top + 4,
      above,
    };
    open = true;
  }

  function handleOutside(e: MouseEvent) {
    if (!(e.target instanceof Node)) return;
    if (triggerEl?.contains(e.target)) return;
    if (listboxEl?.contains(e.target)) return;
    open = false;
  }

  onMount(() => {
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  });
</script>

<div class="relative {className || 'inline-block'}">
  <button
    bind:this={triggerEl}
    type="button"
    onclick={() => open ? (open = false) : openMenu()}
    class="flex items-center gap-1 text-[10px] border border-border rounded px-1.5 py-1 bg-surface
           text-zinc-500 cursor-pointer hover:border-zinc-400 transition-colors w-full min-w-0"
  >
    <span class="truncate flex-1 min-w-0 text-left">{selectedLabel || 'No folder'}</span>
    <svg
      width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
      class="shrink-0 transition-transform duration-100 {open ? 'rotate-180' : ''}"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>
</div>

{#if open}
  <div
    bind:this={listboxEl}
    role="listbox"
    tabindex="-1"
    style="position:fixed; {pos.above ? `bottom:${pos.bottom}px` : `top:${pos.top}px`}; left:{pos.left}px; width:{pos.width}px; z-index:9999;"
    class="bg-surface border border-border rounded-lg shadow-lg py-1 overflow-y-auto max-h-52"
  >
    {#each options as opt (opt.value)}
      <button
        type="button"
        onclick={() => { onchange(opt.value); open = false; }}
        class="w-full text-left px-3 py-1.5 text-xs truncate transition-colors
          {opt.value === value
            ? 'bg-brand/8 text-brand font-medium'
            : 'text-zinc-600 hover:bg-surface-2 hover:text-zinc-800'}"
      >
        {opt.label}
      </button>
    {/each}
  </div>
{/if}
