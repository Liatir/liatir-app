<script lang="ts">
  import type { ActiveDownload } from '$lib/stores/downloads.svelte';
  import { downloadsStore } from '$lib/stores/downloads.svelte';
  import { sanitizeLocalPathsForDisplay } from '$lib/utils';

  let { download }: { download: ActiveDownload } = $props();

  function fmtBytes(b: number): string {
    if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(2)} GB`;
    if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MB`;
    if (b >= 1_024)         return `${(b / 1_024).toFixed(0)} KB`;
    return `${b} B`;
  }

  function fmtSpeed(bps: number): string {
    if (bps <= 0) return '';
    return `${fmtBytes(bps)}/s`;
  }

  function fmtEta(d: ActiveDownload): string {
    if (!d.bytesTotal || d.bytesPerSec <= 0) return '';
    const remaining = d.bytesTotal - d.bytesDownloaded;
    const secs = Math.ceil(remaining / d.bytesPerSec);
    if (secs < 60) return `~${secs}s`;
    return `~${Math.ceil(secs / 60)}m`;
  }

  const pct = $derived(() => {
    if (!download.bytesTotal || download.bytesTotal === 0) return null;
    return Math.min(100, Math.round((download.bytesDownloaded / download.bytesTotal) * 100));
  });
</script>

<div class="rounded-xl border border-border bg-surface p-4 space-y-3">
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-2 min-w-0">
      {#if download.status === 'downloading'}
        <svg class="animate-spin h-3.5 w-3.5 text-brand shrink-0" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
      {:else if download.status === 'done'}
        <svg class="h-3.5 w-3.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      {:else if download.status === 'error'}
        <svg class="h-3.5 w-3.5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      {:else}
        <svg class="h-3.5 w-3.5 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
        </svg>
      {/if}
      <span class="text-xs font-medium text-zinc-800 truncate">{download.label}</span>
    </div>

    <div class="flex items-center gap-2 shrink-0">
      {#if download.status === 'downloading'}
        <button
          onclick={() => downloadsStore.cancel(download.id)}
          class="text-[10px] text-zinc-400 hover:text-red-500 transition-colors"
        >
          Cancel
        </button>
      {:else}
        <button
          onclick={() => downloadsStore.remove(download.id)}
          class="text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          Dismiss
        </button>
      {/if}
    </div>
  </div>

  {#if download.status === 'error'}
    <p class="text-xs text-red-600 font-mono leading-relaxed">{sanitizeLocalPathsForDisplay(download.error ?? 'Download failed.', 2)}</p>
  {:else}
    <!-- Progress bar -->
    <div class="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
      {#if pct() !== null}
        <div
          class="h-full rounded-full transition-all duration-300
            {download.status === 'done' ? 'bg-emerald-500' : 'bg-brand'}"
          style="width: {pct()}%"
        ></div>
      {:else if download.status === 'downloading'}
        <!-- Indeterminate -->
        <div class="h-full w-1/3 bg-brand rounded-full animate-pulse"></div>
      {:else if download.status === 'done'}
        <div class="h-full w-full bg-emerald-500 rounded-full"></div>
      {/if}
    </div>

    <!-- Stats row -->
    <div class="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
      <span>
        {fmtBytes(download.bytesDownloaded)}
        {#if download.bytesTotal}
          / {fmtBytes(download.bytesTotal)}
        {/if}
        {#if pct() !== null}
          · {pct()}%
        {/if}
      </span>
      <span class="flex items-center gap-2">
        {#if download.status === 'downloading'}
          {fmtSpeed(download.bytesPerSec)}
          {fmtEta(download)}
        {:else if download.status === 'done'}
          <span class="text-emerald-600">Done</span>
        {:else if download.status === 'cancelled'}
          <span class="text-zinc-500">Paused — can resume</span>
        {/if}
      </span>
    </div>
  {/if}
</div>
