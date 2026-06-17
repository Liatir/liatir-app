<script lang="ts">
  import { installProgress, type InstallItem } from '$lib/stores/installProgress.svelte';
  import { fmtBytes } from '$lib/utils';

  function phaseLabel(item: InstallItem): string {
    switch (item.phase) {
      case 'downloading':
        if (item.bytesTotal) return `${fmtBytes(item.bytesDownloaded)} / ${fmtBytes(item.bytesTotal)}`;
        if (item.bytesDownloaded > 0) return `${fmtBytes(item.bytesDownloaded)}…`;
        return 'Downloading…';
      case 'extracting':    return 'Extracting…';
      case 'pm-installing': return 'Installing…';
      case 'done':          return 'Installed';
      case 'error':         return item.error ? `Error: ${item.error}` : 'Failed';
    }
  }

  function progress(item: InstallItem): number | null {
    if (item.phase === 'downloading' && item.bytesTotal && item.bytesTotal > 0) {
      return Math.round((item.bytesDownloaded / item.bytesTotal) * 100);
    }
    return null;
  }
</script>

{#if installProgress.hasAny}
  <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none" aria-live="polite">
    {#each installProgress.list as item (item.binary)}
      {@const pct = progress(item)}
      <div
        class="flex flex-col gap-1.5 rounded-xl border shadow-lg px-4 py-3 min-w-[240px] max-w-xs
               pointer-events-auto transition-all
               {item.phase === 'done'  ? 'bg-emerald-50  border-emerald-200' :
                item.phase === 'error' ? 'bg-red-50      border-red-200'     :
                                         'bg-white        border-zinc-200'}"
      >
        <!-- Header row -->
        <div class="flex items-center gap-2">
          {#if item.phase === 'done'}
            <svg class="h-4 w-4 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          {:else if item.phase === 'error'}
            <svg class="h-4 w-4 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          {:else}
            <svg class="h-4 w-4 text-brand shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
              <path class="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          {/if}

          <span class="text-xs font-semibold text-zinc-800 flex-1 truncate">{item.label}</span>

          <button
            onclick={() => installProgress.dismiss(item.binary)}
            class="text-zinc-300 hover:text-zinc-500 transition-colors"
            aria-label="Dismiss"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Phase label -->
        <p class="text-[11px] leading-none
                  {item.phase === 'done'  ? 'text-emerald-600' :
                   item.phase === 'error' ? 'text-red-500 line-clamp-2' :
                                            'text-zinc-500'}">
          {phaseLabel(item)}
        </p>

        <!-- Download progress bar -->
        {#if pct !== null}
          <div class="h-1 rounded-full bg-zinc-100 overflow-hidden">
            <div
              class="h-full rounded-full bg-brand transition-all duration-300"
              style="width: {pct}%"
            ></div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
