<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import { fmtDuration, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { beginDirectNativeToolRun } from '$lib/execution/direct-native-tool';
  import { runNativeTool } from '$lib/utils/native-tool';
  import { parseBcftoolsStats, bcftoolsStatsToToolOutput } from '$lib/tools/variants/bcftools';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import TerminalOutput from '$lib/components/ui/TerminalOutput.svelte';
  import { notify } from '$lib/utils/notify';
  import RunLog from '$lib/components/ui/RunLog.svelte';
  import DepCheck, { type DepStatus } from '$lib/components/ui/DepCheck.svelte';
  import ThreadControl from '$lib/components/tools/ThreadControl.svelte';
  import { DEP_REQUIREMENTS } from '$lib/data/dep-requirements';
  import { threadParam } from '$lib/utils/execution-resources';
  import type { ToolOutput } from '$lib/types/tool-output';

  // ── dep check ────────────────────────────────────────────────────
  let depStatus = $state<DepStatus>('checking');

  // ── form state ───────────────────────────────────────────────────
  let filePath  = $state('');
  let threads   = $state(0);
  let running   = $state(false);
  let startedAt = $state<number | null>(null);
  let now       = $state(Date.now());
  let logLines  = $state<string[]>([]);
  let activeExecutionRunId = $state<string | null>(null);

  $effect(() => {
    if (!running) return;
    const id = setInterval(() => now = Date.now(), 1000);
    return () => clearInterval(id);
  });

  // ── history ──────────────────────────────────────────────────────
  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);

  const bcftoolsRuns = $derived(analysisRuns.byTool('bcftools'));
  const vcfFiles = $derived(dataFiles.byExt('vcf', 'vcf.gz', 'bcf', 'bcf.gz'));
  const selectedRun = $derived(bcftoolsRuns.find(r => r.id === selectedRunId) ?? null);
  const displayError = $derived<string | null>(
    selectedRun?.status === 'error' ? (selectedRun.error ?? 'Unknown error') : null
  );

  $effect(() => {
    const id = selectedRunId;
    if (!id) { loadedOutput = null; return; }
    loadingOutput = true;
    analysisRuns.loadOutput(id).then(out => {
      loadedOutput = out;
      loadingOutput = false;
    });
  });

  onMount(() => {
    dataFiles.init();
    analysisRuns.init();
  });

  // ── run ──────────────────────────────────────────────────────────
  async function runStats() {
    if (!filePath) return;

    running = true;
    selectedRunId = null;
    startedAt = Date.now();

    const runId = crypto.randomUUID();
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const t0 = startedAt;
    const fileSize = dataFiles.files.find(f => f.path === filePath)?.size;
    const inputSizes = fileSize != null ? [fileSize] : undefined;
    const threadInfo = threadParam(threads);
    const params = { subcommand: 'stats', threads: threadInfo.threads, threadsMode: threadInfo.mode };
    const execution = await beginDirectNativeToolRun({
      runId,
      toolId: 'bcftools',
      label: fileName,
      inputs: [filePath],
      params,
      startedAt: t0,
    }).catch(async (error) => {
      await notify('BCFtools failed', String(error));
      return null;
    });
    if (!execution) {
      running = false;
      startedAt = null;
      return;
    }
    activeExecutionRunId = runId;

    try {
      logLines = [`$ bcftools stats --threads ${threadInfo.threads} ${fileName}`];
      const result = await runNativeTool(
        'bcftools',
        ['stats', '--threads', String(threadInfo.threads), filePath],
        undefined,
        (line) => { if (line.trim()) logLines.push(line); },
        execution.nativeOptions(),
      );

      if (!result.ok && result.stdout.trim() === '') {
        throw new Error(result.stderr || `bcftools exited with code ${result.exitCode}`);
      }

      const parsed = parseBcftoolsStats(result.stdout);
      const output = bcftoolsStatsToToolOutput(parsed, result.stdout);
      const endedAt = Date.now();

      await execution.finalize('done', {
        id: runId, tool: 'bcftools', label: fileName,
        inputs: [filePath], inputSizes,
        params,
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output, error: null,
        log: [...logLines],
      });
      await notify('BCFtools complete', `${fileName} finished in ${fmtDuration(t0, endedAt)}`, endedAt - t0);
    } catch (e) {
      const endedAt = Date.now();
      const cancelled = execution.isCancelled(e);
      const message = cancelled ? 'BCFtools run was cancelled.' : String(e);
      logLines.push(cancelled ? `■ ${message}` : `✗ Error: ${message}`);
      await execution.finalize(cancelled ? 'cancelled' : 'error', {
        id: runId, tool: 'bcftools', label: fileName,
        inputs: [filePath], inputSizes,
        params,
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output: null, error: message,
        log: [...logLines],
      });
      await notify(cancelled ? 'BCFtools cancelled' : 'BCFtools failed', message);
    } finally {
      running = false;
      startedAt = null;
      activeExecutionRunId = null;
      selectedRunId = runId;
    }
  }

  async function cancelRun() {
    if (activeExecutionRunId) await executionRuns.cancel(activeExecutionRunId);
  }

  async function deleteRun(id: string, label: string) {
    const ok = await confirm({
      title: 'Delete run',
      message: `Delete the run for "${label}"?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    if (selectedRunId === id) {
      selectedRunId = bcftoolsRuns.find(r => r.id !== id)?.id ?? null;
    }
    await analysisRuns.remove(id);
  }

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
</script>

<div class="flex h-full overflow-hidden">

  <!-- Run history sidebar -->
  <div class="w-52 shrink-0 border-r border-border bg-surface flex flex-col">
    <div class="flex items-center justify-between px-3 py-3 border-b border-border">
      <span class="text-xs font-medium text-text-secondary">Run history</span>
      {#if bcftoolsRuns.length > 0}
        <span class="text-[10px] text-text-subtle">{bcftoolsRuns.length}</span>
      {/if}
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if bcftoolsRuns.length === 0}
        <p class="text-xs text-text-subtle text-center py-8 px-3 leading-relaxed">
          No runs yet.<br />Results will appear here.
        </p>
      {:else}
        {#each bcftoolsRuns as run (run.id)}
          <div
            class="group relative flex items-start transition-colors
              {selectedRunId === run.id ? 'bg-brand/8' : 'hover:bg-surface-2'}"
          >
            <button
              onclick={() => selectedRunId = run.id}
              class="flex-1 text-left px-3 py-2.5 min-w-0"
            >
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="h-1.5 w-1.5 rounded-full shrink-0
                  {run.status === 'done' ? 'bg-emerald-500' : 'bg-red-500'}">
                </span>
                <p class="text-xs font-medium truncate
                  {selectedRunId === run.id ? 'text-brand' : 'text-text-secondary'}">
                  {run.label}
                </p>
              </div>
              <p class="text-[10px] text-text-subtle pl-3">
                {fmtDate(run.startedAt)} · {fmtDuration(run.startedAt, run.endedAt)}
              </p>
            </button>
            <button
              onclick={() => deleteRun(run.id, run.label)}
              aria-label="Delete run"
              class="opacity-0 group-hover:opacity-100 p-1.5 mt-2 mr-1.5 shrink-0
                     text-text-subtle hover:text-red-500 transition-all rounded"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Main content -->
  <div class="flex-1 flex flex-col overflow-hidden">
    <PageHeader
      title="BCFtools"
      description="Variant statistics for VCF/BCF files"
    >
      {#snippet actions()}
        <Button variant="ghost" size="sm" onclick={() => goto('/tools')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Back
        </Button>
      {/snippet}
    </PageHeader>

    <div class="flex-1 overflow-y-auto p-6 space-y-5">

      <DepCheck req={DEP_REQUIREMENTS.bcftools} onStatusChange={(s) => depStatus = s} />

      {#if depStatus === 'ok'}
        <Card class="p-5 space-y-4">
          <h2 class="text-sm font-semibold text-text">stats</h2>

          <FilePickerPopup
            files={vcfFiles}
            value={filePath}
            label="VCF / BCF file"
            emptyText="No VCF/BCF files in Data yet."
            disabled={running}
            onchange={(p) => filePath = p}
          />

          <ThreadControl value={threads} disabled={running} onchange={(value) => threads = value} />

          <div class="flex items-center gap-3 pt-1">
            <Button
              variant="primary"
              testId="direct-native-run"
              disabled={!filePath || running}
              loading={running}
              onclick={runStats}
            >
              Run stats
            </Button>
            {#if running && activeExecutionRunId}
              <Button variant="secondary" testId="direct-native-cancel" onclick={cancelRun}>Cancel</Button>
            {/if}
            {#if running && startedAt}
              <span class="text-xs text-text-subtle">
                Elapsed: {fmtDuration(startedAt, now)}
              </span>
            {/if}
          </div>
          <TerminalOutput lines={logLines} {running} />
        </Card>

        {#if displayError}
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono" data-selectable>
            {sanitizeLocalPathsForDisplay(displayError, 2)}
          </div>
        {:else if loadingOutput}
          <div class="flex justify-center py-12">
            <svg class="animate-spin h-5 w-5 text-text-subtle" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          </div>
        {:else if loadedOutput}
          <div>
            <p class="mb-2 text-[10px] font-semibold text-text-subtle uppercase tracking-wider">Last run result</p>
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-xs font-medium text-text-secondary">{selectedRun?.label ?? 'Results'}</h2>
              {#if selectedRun}
                <span class="text-xs text-text-subtle">
                  {fmtDate(selectedRun.startedAt)} · {fmtDuration(selectedRun.startedAt, selectedRun.endedAt)}
                </span>
              {/if}
            </div>
            <ToolResultView output={loadedOutput} />
            <RunLog runId={selectedRunId} />
          </div>
        {/if}
      {/if}

    </div>
  </div>
</div>
