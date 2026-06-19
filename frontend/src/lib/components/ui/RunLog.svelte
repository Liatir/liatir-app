<script lang="ts">
  import { liatir } from '$lib/api';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import TerminalOutput from './TerminalOutput.svelte';

  interface Props {
    runId: string | null;
  }

  let { runId }: Props = $props();

  let open    = $state(false);
  let log     = $state<string[] | null>(null);
  let loading = $state(false);
  let copied  = $state(false);

  $effect(() => {
    const id = runId;
    open = false;
    log  = null;
  });

  async function toggle() {
    if (!runId) return;
    open = !open;
    if (open && log === null) {
      loading = true;
      log = await analysisRuns.loadLog(runId);
      loading = false;
    }
  }

  async function copyLog() {
    if (!log) return;
    const api = liatir();
    await api?.desktop.clipboard.writeText(log.join('\n'));
    copied = true;
    setTimeout(() => copied = false, 1500);
  }

  async function exportLog() {
    if (!log || !runId) return;
    const api = liatir();
    if (!api) return;
    try {
      const dest = await api.desktop.files.save(`liatir-log-${runId.slice(0, 8)}.txt`);
      if (dest) {
        await api.invoke('lia_write_file_path', { path: dest, content: log.join('\n') } as any);
      }
    } catch { /* cancelled */ }
  }
</script>

{#if runId}
  <div class="mt-3">
    <!-- Toggle row -->
    <div class="flex items-center gap-2">
      <button
        onclick={toggle}
        class="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors"
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
          class="transition-transform {open ? 'rotate-90' : ''}"
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        Run log
      </button>

      {#if open && log && log.length > 0}
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

    {#if open}
      {#if loading}
        <p class="text-[11px] text-zinc-400 mt-2">Loading…</p>
      {:else if !log || log.length === 0}
        <p class="text-[11px] text-zinc-400 mt-2">No log available for this run.</p>
      {:else}
        <div class="mt-2">
          <TerminalOutput lines={log} running={false} />
        </div>
      {/if}
    {/if}
  </div>
{/if}
