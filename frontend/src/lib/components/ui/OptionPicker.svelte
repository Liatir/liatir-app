<script lang="ts">
  import InfoPopup from './InfoPopup.svelte';
  import { clickOutside } from '$lib/actions/clickOutside';

  export interface PickerItem {
    value: string;
    label: string;
    sublabel?: string;
    badge?: string;
    meta?: string;
  }

  export interface PickerGroup {
    title?: string;
    items: PickerItem[];
  }

  interface Props {
    value: string;
    groups: PickerGroup[];
    label?: string;
    info?: string;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    emptyHref?: string;
    disabled?: boolean;
    onchange: (value: string) => void;
  }

  let {
    value,
    groups,
    label,
    info,
    placeholder = 'Select…',
    searchPlaceholder = 'Search…',
    emptyText = 'No options available.',
    emptyHref,
    disabled = false,
    onchange,
  }: Props = $props();

  let open = $state(false);
  let query = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);

  const allItems = $derived(groups.flatMap(g => g.items));
  const hasItems = $derived(allItems.length > 0);
  const selected = $derived(allItems.find(item => item.value === value) ?? null);

  const filteredGroups = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map(g => ({
        ...g,
        items: g.items.filter(item =>
          item.label.toLowerCase().includes(q) ||
          (item.sublabel?.toLowerCase().includes(q) ?? false)
        ),
      }))
      .filter(g => g.items.length > 0);
  });

  const filteredCount = $derived(filteredGroups.reduce((n, g) => n + g.items.length, 0));
  const firstResult = $derived(filteredGroups[0]?.items[0] ?? null);

  function pick(val: string) {
    onchange(val);
    open = false;
    query = '';
  }

  function tryOpen() {
    if (!disabled && hasItems) open = true;
  }

  function close() {
    open = false;
    query = '';
  }

  $effect(() => {
    if (open && searchInput) setTimeout(() => searchInput?.focus(), 30);
  });
</script>

<div class="relative" use:clickOutside={{ enabled: open, onOutside: close }}>
  {#if label}
    <p class="mb-1.5 flex items-center gap-1 text-xs text-zinc-500">
      <span>{label}</span>
      {#if info}
        <InfoPopup text={info} />
      {/if}
    </p>
  {/if}

  <div class="relative">
    <!-- Trigger -->
    <button
      type="button"
      onclick={tryOpen}
      {disabled}
      class="w-full flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors
             {selected || (!hasItems && emptyHref) ? 'pr-10' : ''}
             {open ? 'border-brand ring-1 ring-brand/20' : 'border-border hover:border-border-2'}
             {!hasItems || disabled ? 'opacity-50 cursor-default' : 'cursor-pointer'}"
    >
      {#if selected}
        <span class="flex-1 min-w-0">
          <span class="block text-sm font-medium text-brand truncate">{selected.label}</span>
          {#if selected.sublabel}
            <span class="block text-[11px] text-zinc-400 truncate">{selected.sublabel}</span>
          {/if}
        </span>
        {#if selected.badge}
          <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-500 border border-zinc-200">{selected.badge}</span>
        {/if}
      {:else if !hasItems}
        <span class="flex-1 text-sm text-zinc-400">{emptyText}</span>
      {:else}
        <span class="flex-1 text-sm text-zinc-400">{placeholder}</span>
        <svg class="shrink-0 text-zinc-300" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      {/if}
    </button>

    {#if selected && !disabled}
      <button
        type="button"
        onclick={(e) => { e.stopPropagation(); pick(''); }}
        class="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-300 hover:text-zinc-500 transition-colors p-0.5"
        aria-label="Clear selection"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    {:else if !hasItems && emptyHref}
      <a
        href={emptyHref}
        class="absolute right-3 top-1/2 -translate-y-1/2 text-brand text-xs font-medium hover:underline"
      >
        Go →
      </a>
    {/if}
  </div>

  {#if open}
  <!-- Popup (nowheel: scrolling the list must not zoom the pipeline canvas) -->
  <div class="nowheel fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
              w-full max-w-md rounded-xl border border-border bg-white shadow-xl overflow-hidden">

    <!-- Search -->
    <div class="flex items-center gap-2 px-3 py-2.5 border-b border-border">
      <svg class="shrink-0 text-zinc-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        bind:this={searchInput}
        bind:value={query}
        placeholder={searchPlaceholder}
        class="flex-1 text-sm bg-transparent outline-none text-zinc-800 placeholder:text-zinc-400"
        onkeydown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Enter' && firstResult) pick(firstResult.value);
        }}
      />
      <button onclick={close} class="shrink-0 text-zinc-300 hover:text-zinc-500 transition-colors" aria-label="Close">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Options -->
    <div class="max-h-72 overflow-y-auto">
      {#if filteredCount === 0}
        <p class="text-sm text-zinc-400 text-center py-8">
          {query ? `No results for "${query}"` : emptyText}
        </p>
      {:else}
        {#each filteredGroups as group}
          {#if group.title}
            <p class="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider sticky top-0 bg-white">
              {group.title}
            </p>
          {/if}
          {#each group.items as item (item.value)}
            {@const sel = item.value === value}
            <button
              type="button"
              onclick={() => pick(item.value)}
              class="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                     {sel ? 'bg-brand/8' : 'hover:bg-zinc-50'}"
            >
              <span class="flex-1 min-w-0">
                <span class="block text-sm font-medium truncate {sel ? 'text-brand' : 'text-zinc-800'}">{item.label}</span>
                {#if item.sublabel}
                  <span class="block text-[11px] text-zinc-400 truncate">{item.sublabel}</span>
                {/if}
              </span>
              <div class="shrink-0 flex items-center gap-1.5">
                {#if item.meta}
                  <span class="text-[10px] font-mono text-zinc-400">{item.meta}</span>
                {/if}
                {#if item.badge}
                  <span class="rounded px-1.5 py-0.5 text-[10px] font-medium border
                    {sel ? 'bg-brand/10 border-brand/20 text-brand' : 'bg-zinc-100 border-zinc-200 text-zinc-500'}">
                    {item.badge}
                  </span>
                {/if}
              </div>
            </button>
          {/each}
        {/each}
      {/if}
    </div>

    <!-- Footer -->
    <div class="px-3 py-2 border-t border-border text-[10px] text-zinc-400">
      {filteredCount} of {allItems.length} option{allItems.length !== 1 ? 's' : ''}
    </div>
  </div>
  {/if}
</div>
