<!--
  What a run recorded, on every screen that shows a run.

  A run's transcript and its folder answer the same question — what did this actually do — so they
  belong to the run, not to its results. Attaching them to the result view instead meant they
  disappeared exactly where they were most needed: a run with no structured output, or a failure.
  This sits next to the result view on the Results screen, on every tool page, on the AI page and on
  External Workflows, and it needs nothing but the run id.
-->
<script lang="ts">
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { revealRunDir } from '$lib/execution/run-storage';
  import { copyTextToClipboard, saveTextToFile } from '$lib/utils/log-export';
  import TerminalOutput from './TerminalOutput.svelte';

  interface Props {
    runId: string | null;
  }

  let { runId }: Props = $props();

  let open    = $state(false);
  let log     = $state<string[] | null>(null);
  let loading = $state(false);
  let copied  = $state(false);
  let folderNote = $state<string | null>(null);

  $effect(() => {
    const id = runId;
    open = false;
    log  = null;
    folderNote = null;
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

  async function openFolder() {
    if (!runId) return;
    // Whatever happens, say so. A button that appears to do nothing is what this replaced.
    const outcome = await revealRunDir(runId);
    folderNote = outcome.ok
      ? null
      : outcome.reason === 'no-directory'
        ? 'This run wrote no files.'
        : `Could not open the folder: ${outcome.reason}`;
  }

  async function copyLog() {
    if (!log) return;
    await copyTextToClipboard(log.join('\n'));
    copied = true;
    setTimeout(() => copied = false, 1500);
  }

  async function exportLog() {
    if (!log || !runId) return;
    await saveTextToFile(`liatir-log-${runId.slice(0, 8)}.txt`, log.join('\n'));
  }
</script>

{#if runId}
  <div class="mt-3">
    <!-- Toggle row -->
    <div class="flex items-center gap-2">
      <button
        onclick={toggle}
        class="flex items-center gap-1.5 text-[11px] text-text-subtle hover:text-text-secondary transition-colors"
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
          class="transition-transform {open ? 'rotate-90' : ''}"
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        View log
      </button>

      <!--
        Bordered, unlike its neighbours. Small is right — it is not the point of the screen — but
        as plain 11px text beside "View log" it read as a footnote and went unnoticed. The border is
        what makes it look like something you press.
      -->
      <button
        onclick={openFolder}
        data-testid="open-run-folder"
        class="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1
               text-[11px] font-medium text-text-secondary
               hover:border-text-subtle hover:text-text transition-colors"
      >
        <svg
          width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
        >
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
        </svg>
        Open run folder
      </button>

      {#if folderNote}
        <span class="text-[10px] text-text-subtle" data-testid="open-run-folder-note">{folderNote}</span>
      {/if}

      {#if open && log && log.length > 0}
        <button
          onclick={copyLog}
          class="text-[10px] text-text-subtle hover:text-text-secondary transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
        <button
          onclick={exportLog}
          class="text-[10px] text-text-subtle hover:text-text-secondary transition-colors"
        >
          Export .txt
        </button>
      {/if}
    </div>

    {#if open}
      {#if loading}
        <p class="text-[11px] text-text-subtle mt-2">Loading…</p>
      {:else if !log || log.length === 0}
        <p class="text-[11px] text-text-subtle mt-2">No log available for this run.</p>
      {:else}
        <div class="mt-2">
          <TerminalOutput lines={log} running={false} />
        </div>
      {/if}
    {/if}
  </div>
{/if}
