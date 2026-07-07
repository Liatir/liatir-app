<script lang="ts">
  import { liatir } from '$lib/api';
  import { jobsStore, type PluginLogEntry, type LogLevel } from '$lib/stores/jobs.svelte';

  interface Props {
    jobId: string | null;
    /** If true, show logs inline. If false, show collapsible toggle. */
    inline?: boolean;
  }

  let { jobId, inline = false }: Props = $props();

  let open = $state(inline);
  let copied = $state(false);

  const logs = $derived(() => {
    if (!jobId) return [];
    return jobsStore.getLogs(jobId);
  });

  $effect(() => {
    const id = jobId;
    if (!inline) open = false;
  });

  function levelColor(level: LogLevel): string {
    switch (level) {
      case 'error': return 'text-red-600';
      case 'warn': return 'text-amber-600';
      case 'info': return 'text-zinc-700';
      case 'debug': return 'text-zinc-400';
    }
  }

  function levelBadge(level: LogLevel): string {
    switch (level) {
      case 'error': return 'ERR';
      case 'warn': return 'WRN';
      case 'info': return 'INF';
      case 'debug': return 'DBG';
    }
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  async function copyLog() {
    const entries = logs();
    if (entries.length === 0) return;
    const api = liatir();
    const text = entries.map(e => `[${formatTime(e.timestampMs)}] [${e.level.toUpperCase()}] ${e.message}`).join('\n');
    await api?.desktop.clipboard.writeText(text);
    copied = true;
    setTimeout(() => copied = false, 1500);
  }

  async function exportLog() {
    const entries = logs();
    if (entries.length === 0 || !jobId) return;
    const api = liatir();
    if (!api) return;
    try {
      const dest = await api.desktop.files.save(`liatir-job-log-${jobId.slice(0, 8)}.txt`);
      if (dest) {
        const text = entries.map(e => `[${formatTime(e.timestampMs)}] [${e.level.toUpperCase()}] ${e.message}`).join('\n');
        await api.invoke('lia_write_file_path', { path: dest, content: text } as any);
      }
    } catch { /* cancelled */ }
  }
</script>

{#if jobId}
  <div class="mt-3">
    {#if !inline}
      <!-- Toggle row -->
      <div class="flex items-center gap-2">
        <button
          onclick={() => open = !open}
          class="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
            class="transition-transform {open ? 'rotate-90' : ''}"
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          View logs ({logs().length})
        </button>

        {#if open && logs().length > 0}
          <button
            onclick={copyLog}
            class="text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button
            onclick={exportLog}
            class="text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            Export .txt
          </button>
        {/if}
      </div>
    {:else if logs().length > 0}
      <!-- Inline header with actions -->
      <div class="flex items-center justify-between mb-2">
        <span class="text-[11px] text-zinc-500 font-medium">Logs ({logs().length})</span>
        <div class="flex items-center gap-2">
          <button
            onclick={copyLog}
            class="text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button
            onclick={exportLog}
            class="text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            Export .txt
          </button>
        </div>
      </div>
    {/if}

    {#if open}
      {#if logs().length === 0}
        <p class="text-[11px] text-zinc-400 mt-2">No logs yet for this job.</p>
      {:else}
        <div class="mt-2 rounded-lg bg-zinc-50 border border-zinc-200 overflow-hidden">
          <div class="max-h-64 overflow-y-auto p-2 font-mono text-[11px] space-y-0.5">
            {#each logs() as entry (entry.timestampMs)}
              <div class="flex items-start gap-2 leading-relaxed">
                <span class="text-zinc-400 shrink-0">{formatTime(entry.timestampMs)}</span>
                <span class="shrink-0 font-semibold {levelColor(entry.level)}">{levelBadge(entry.level)}</span>
                <span class="text-zinc-700 break-all">{entry.message}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
{/if}