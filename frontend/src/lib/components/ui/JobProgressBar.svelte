<script lang="ts">
  import type { JobProgress } from '$lib/stores/jobs.svelte';

  let { progress, label }: { progress: JobProgress | null; label?: string } = $props();

  const pct = $derived(() => {
    if (!progress || !progress.total || progress.total === 0) return null;
    return Math.min(100, Math.round((progress.current / progress.total) * 100));
  });

  const displayLabel = $derived(() => {
    return progress?.label ?? label ?? '';
  });
</script>

{#if progress && !progress.done}
  <div class="space-y-1.5">
    {#if displayLabel()}
      <p class="text-xs text-zinc-600 truncate">{displayLabel()}</p>
    {/if}

    <!-- Progress bar -->
    <div class="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
      {#if pct() !== null}
        <div
          class="h-full rounded-full transition-all duration-300 bg-brand"
          style="width: {pct()}%"
        ></div>
      {:else}
        <!-- Indeterminate -->
        <div class="h-full w-1/3 bg-brand rounded-full animate-pulse"></div>
      {/if}
    </div>

    <!-- Stats row -->
    <div class="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
      <span>
        {progress.current}
        {#if progress.total}
          / {progress.total}
        {/if}
        {#if pct() !== null}
          · {pct()}%
        {/if}
      </span>
    </div>
  </div>
{/if}