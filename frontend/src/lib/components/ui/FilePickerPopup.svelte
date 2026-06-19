<script lang="ts">
  import type { DataFile } from '$lib/stores/dataFiles.svelte';

  interface Props {
    files: DataFile[];
    value: string;
    placeholder?: string;
    label?: string;
    emptyHref?: string;
    emptyText?: string;
    disabled?: boolean;
    onchange: (path: string) => void;
  }

  let {
    files,
    value,
    placeholder = 'Select a file…',
    label,
    emptyHref = '/data',
    emptyText = 'No files in Data yet.',
    disabled = false,
    onchange,
  }: Props = $props();

  let open = $state(false);
  let query = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);

  const selected = $derived(files.find(f => f.path === value) ?? null);

  const filtered = $derived(
    query.trim() === ''
      ? files
      : files.filter(f =>
          f.name.toLowerCase().includes(query.toLowerCase()) ||
          f.path.toLowerCase().includes(query.toLowerCase())
        )
  );

  function pick(path: string) {
    onchange(path);
    open = false;
    query = '';
  }

  function close() {
    open = false;
    query = '';
  }

  $effect(() => {
    if (open && searchInput) {
      // tiny delay so the DOM is mounted
      setTimeout(() => searchInput?.focus(), 30);
    }
  });

  function fmtBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024 ** 3).toFixed(2)} GB`;
  }

  function truncatePath(path: string, max = 52): string {
    if (path.length <= max) return path;
    const parts = path.split(/[\\/]/);
    return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : '…' + path.slice(-(max - 1));
  }
</script>

<div class="relative">
  {#if label}
    <p class="text-xs text-zinc-500 mb-1.5">{label}</p>
  {/if}

  <!-- Trigger button -->
  <button
    type="button"
    onclick={() => { if (files.length > 0 && !disabled) open = true; }}
    disabled={disabled}
    class="w-full flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors
           {open ? 'border-brand ring-1 ring-brand/20' : 'border-border hover:border-border-2'}
           {files.length === 0 || disabled ? 'opacity-50 cursor-default' : ''}"
  >
    {#if selected}
      <svg class="shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4f39f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
      <span class="flex-1 min-w-0">
        <span class="block text-sm font-medium text-brand truncate">{selected.name}</span>
        <span class="block text-[11px] text-zinc-400 truncate">{truncatePath(selected.path)}{selected.size != null ? ' · ' + fmtBytes(selected.size) : ''}</span>
      </span>
      <button
        type="button"
        onclick={(e) => { e.stopPropagation(); pick(''); }}
        class="shrink-0 text-zinc-300 hover:text-zinc-500 transition-colors p-0.5"
        aria-label="Clear"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    {:else if files.length === 0}
      <span class="text-sm text-zinc-400">{emptyText}</span>
      <a href={emptyHref} class="ml-auto text-brand text-xs font-medium hover:underline shrink-0" onclick={(e) => e.stopPropagation()}>Go to Data →</a>
    {:else}
      <svg class="shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
      <span class="flex-1 text-sm text-zinc-400">{placeholder}</span>
      <svg class="shrink-0 text-zinc-300" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    {/if}
  </button>
</div>

<!-- Modal overlay -->
{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-40"
    role="presentation"
    onclick={close}
    onkeydown={(e) => e.key === 'Escape' && close()}
  ></div>

  <!-- Popup -->
  <div class="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
              w-full max-w-md rounded-xl border border-border bg-white shadow-xl">

    <!-- Header -->
    <div class="flex items-center gap-2 px-3 py-2.5 border-b border-border">
      <svg class="shrink-0 text-zinc-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        bind:this={searchInput}
        bind:value={query}
        placeholder="Search files…"
        class="flex-1 text-sm bg-transparent outline-none text-zinc-800 placeholder:text-zinc-400"
        onkeydown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Enter' && filtered.length === 1) pick(filtered[0].path);
        }}
      />
      <button onclick={close} class="shrink-0 text-zinc-300 hover:text-zinc-500 transition-colors" aria-label="Close">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <!-- File list -->
    <div class="max-h-72 overflow-y-auto py-1">
      {#if filtered.length === 0}
        <p class="text-sm text-zinc-400 text-center py-8">No files match "{query}"</p>
      {:else}
        {#each filtered as file (file.id)}
          <button
            type="button"
            onclick={() => pick(file.path)}
            class="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                   {file.path === value ? 'bg-brand/8' : 'hover:bg-zinc-50'}"
          >
            <svg class="shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke={file.path === value ? '#4f39f6' : '#a1a1aa'}
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-medium truncate {file.path === value ? 'text-brand' : 'text-zinc-800'}">{file.name}</span>
              <span class="block text-[11px] text-zinc-400 truncate">{truncatePath(file.path)}</span>
            </span>
            <div class="shrink-0 flex items-center gap-1.5">
              {#if file.size != null}
                <span class="text-[10px] font-mono text-zinc-400">{fmtBytes(file.size)}</span>
              {/if}
              <span class="rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-500 border border-zinc-200">{file.ext || '?'}</span>
            </div>
          </button>
        {/each}
      {/if}
    </div>

    <!-- Footer count -->
    <div class="px-3 py-2 border-t border-border text-[10px] text-zinc-400">
      {filtered.length} of {files.length} file{files.length !== 1 ? 's' : ''}
    </div>
  </div>
{/if}
