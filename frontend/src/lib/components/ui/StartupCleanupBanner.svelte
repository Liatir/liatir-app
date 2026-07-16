<script lang="ts">
  import { liatir } from '$lib/api';
  import { onMount } from 'svelte';

  interface ResumableDownload {
    path: string;
    partPath: string;
    sizeBytes: number;
  }

  interface CleanupReport {
    resumableDownloads: ResumableDownload[];
    cacheClearedBytes: number;
    corruptedRunsRemoved: number;
    errors: string[];
  }

  let report = $state<CleanupReport | null>(null);
  let dismissed = $state(false);
  let deletingPart = $state<Set<string>>(new Set());

  function fmtBytes(b: number): string {
    if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
    if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MB`;
    if (b >= 1_024)         return `${(b / 1_024).toFixed(0)} KB`;
    return `${b} B`;
  }

  function basename(path: string): string {
    return path.split('/').pop() ?? path;
  }

  const hasAnything = $derived(
    !dismissed && report !== null && (
      report.resumableDownloads.length > 0 ||
      report.cacheClearedBytes > 0 ||
      report.corruptedRunsRemoved > 0
    )
  );

  async function deletePart(rd: ResumableDownload) {
    const api = liatir();
    if (!api) return;
    deletingPart = new Set([...deletingPart, rd.partPath]);
    try {
      await api.invoke('lia_cleanup_delete_part', { partPath: rd.partPath } as any);
      if (report) {
        report = {
          ...report,
          resumableDownloads: report.resumableDownloads.filter(r => r.partPath !== rd.partPath),
        };
      }
    } finally {
      const next = new Set(deletingPart);
      next.delete(rd.partPath);
      deletingPart = next;
    }
  }

  onMount(async () => {
    const api = liatir();
    if (!api) return;
    try {
      report = await api.invoke('lia_startup_cleanup') as CleanupReport;
      // auto-dismiss if nothing interesting
      if (
        report.resumableDownloads.length === 0 &&
        report.cacheClearedBytes === 0 &&
        report.corruptedRunsRemoved === 0
      ) {
        dismissed = true;
      }
    } catch {
      // silently ignore — cleanup is best-effort
    }
  });
</script>

{#if hasAnything && report}
  <div
    class="fixed bottom-4 left-4 z-40 max-w-xs w-72 rounded-xl border border-border bg-surface shadow-lg text-xs"
    aria-live="polite"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-2.5 border-b border-border">
      <span class="font-semibold text-text-secondary">Startup cleanup</span>
      <button
        onclick={() => (dismissed = true)}
        class="text-text-faint hover:text-text-muted transition-colors"
        aria-label="Dismiss"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="px-4 py-3 space-y-3">

      <!-- Summary stats -->
      {#if report.cacheClearedBytes > 0 || report.corruptedRunsRemoved > 0}
        <div class="text-text-muted space-y-0.5">
          {#if report.cacheClearedBytes > 0}
            <p>Cache cleared: {fmtBytes(report.cacheClearedBytes)}</p>
          {/if}
          {#if report.corruptedRunsRemoved > 0}
            <p>Corrupted run records removed: {report.corruptedRunsRemoved}</p>
          {/if}
        </div>
      {/if}

      <!-- Resumable downloads -->
      {#if report.resumableDownloads.length > 0}
        <div>
          <p class="font-medium text-text-secondary mb-1.5">Interrupted downloads</p>
          <div class="space-y-1.5">
            {#each report.resumableDownloads as rd (rd.partPath)}
              <div class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <p class="truncate font-mono text-text-secondary">{basename(rd.path)}</p>
                  <p class="text-text-subtle">{fmtBytes(rd.sizeBytes)} saved</p>
                </div>
                <button
                  onclick={() => deletePart(rd)}
                  disabled={deletingPart.has(rd.partPath)}
                  class="shrink-0 text-[10px] px-2 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                >
                  {deletingPart.has(rd.partPath) ? '…' : 'Delete'}
                </button>
              </div>
            {/each}
          </div>
          <p class="text-text-subtle mt-1.5">Partial files can be resumed — delete only if you want to start fresh.</p>
        </div>
      {/if}

    </div>
  </div>
{/if}
