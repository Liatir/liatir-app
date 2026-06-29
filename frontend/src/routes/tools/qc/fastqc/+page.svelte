<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import InfoPopup from '$lib/components/ui/InfoPopup.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import { liatir } from '$lib/api';
  import { fmtDuration, fmtBytes } from '$lib/utils';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns, type AnalysisRun } from '$lib/stores/analysisRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import type { ToolOutput } from '$lib/types/tool-output';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import TerminalOutput from '$lib/components/ui/TerminalOutput.svelte';
  import { notify } from '$lib/utils/notify';
  import RunLog from '$lib/components/ui/RunLog.svelte';

  // ── form state ─────────────────────────────────────────────────
  let maxReads = $state<number | undefined>(undefined);
  let timeoutSec = $state(120);
  let filePath = $state('');
  let running   = $state(false);
  let startedAt = $state<number | null>(null);
  let now       = $state(Date.now());
  let logLines  = $state<string[]>([]);

  $effect(() => {
    if (!running) return;
    const id = setInterval(() => now = Date.now(), 1000);
    return () => clearInterval(id);
  });

  function smartTimeout(sizeBytes: number | undefined): number {
    if (sizeBytes == null) return 120;
    const mb = sizeBytes / (1024 * 1024);
    return Math.min(600, Math.max(30, Math.ceil(mb * 2)));
  }

  // ── history ────────────────────────────────────────────────────
  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);

  const fastqcRuns = $derived(analysisRuns.byTool('fastqc'));
  const fastqFiles = $derived(dataFiles.byExt('fastq', 'fastq.gz'));
  const selectedRun = $derived(fastqcRuns.find(r => r.id === selectedRunId) ?? null);
  const displayError = $derived<string | null>(
    selectedRun?.status === 'error' ? (selectedRun.error ?? 'Unknown error') : null
  );

  // Load output from disk whenever selection changes
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

  // ── run ────────────────────────────────────────────────────────
  async function runFastqc() {
    if (!filePath) return;
    const api = liatir();
    if (!api) return;

    running = true;
    selectedRunId = null;
    startedAt = Date.now();
    logLines = [];

    const runId = crypto.randomUUID();
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const t0 = startedAt;
    const fileSize = dataFiles.files.find(f => f.path === filePath)?.size;
    const inputSizes = fileSize != null ? [fileSize] : undefined;
    const sizeLine = fileSize != null ? ` (${fmtBytes(fileSize)})` : '';
    logLines = [
      `$ fastqc ${fileName}`,
      `→ Input: ${fileName}${sizeLine}`,
      `→ Running WASM quality analysis…`,
    ];

    try {
      const output = await api.qc.fastqc.run({ input: filePath, maxReads, timeoutMs: timeoutSec * 1000 });
      const endedAt = Date.now();
      logLines.push(`✓ Analysis complete in ${fmtDuration(t0, endedAt)}`);
      await analysisRuns.add({
        id: runId, tool: 'fastqc', label: fileName,
        inputs: [filePath], inputSizes,
        params: maxReads !== undefined ? { maxReads } : {},
        status: 'done',
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output, error: null,
        log: [...logLines],
      });
      await notify('FastQC complete', `${fileName} finished in ${fmtDuration(t0, endedAt)}`, endedAt - t0);
    } catch (e) {
      const endedAt = Date.now();
      logLines.push(`✗ Error: ${String(e)}`);
      await analysisRuns.add({
        id: runId, tool: 'fastqc', label: fileName,
        inputs: [filePath], inputSizes,
        params: maxReads !== undefined ? { maxReads } : {},
        status: 'error',
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output: null, error: String(e),
        log: [...logLines],
      });
      await notify('FastQC failed', String(e));
    } finally {
      running = false;
      startedAt = null;
      selectedRunId = runId;
    }
  }

  async function deleteRun(id: string, label: string) {
    const ok = await confirm({
      title: 'Delete run',
      message: `Delete the run for "${label}"?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    if (selectedRunId === id) {
      selectedRunId = fastqcRuns.find(r => r.id !== id)?.id ?? null;
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
      <span class="text-xs font-medium text-zinc-600">Run history</span>
      {#if fastqcRuns.length > 0}
        <span class="text-[10px] text-zinc-400">{fastqcRuns.length}</span>
      {/if}
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if fastqcRuns.length === 0}
        <p class="text-xs text-zinc-400 text-center py-8 px-3 leading-relaxed">
          No runs yet.<br />Results will appear here.
        </p>
      {:else}
        {#each fastqcRuns as run (run.id)}
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
                  {selectedRunId === run.id ? 'text-brand' : 'text-zinc-700'}">
                  {run.label}
                </p>
              </div>
              <p class="text-[10px] text-zinc-400 pl-3">
                {fmtDate(run.startedAt)} · {fmtDuration(run.startedAt, run.endedAt)}
              </p>
            </button>
            <button
              onclick={() => deleteRun(run.id, run.label)}
              aria-label="Delete run"
              class="opacity-0 group-hover:opacity-100 p-1.5 mt-2 mr-1.5 shrink-0
                     text-zinc-400 hover:text-red-500 transition-all rounded"
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
      title="FastQC"
      description="FASTQ quality control analysis"
      info="FastQC analyses the quality of raw sequencing reads in FASTQ format. It reports per-base quality scores, GC content, read length distribution, and other metrics to help assess whether sequencing data is suitable for downstream analysis."
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

      <!-- Input -->
      <Card class="p-5 space-y-4">
        <h2 class="text-sm font-semibold text-zinc-800">Input</h2>

        <FilePickerPopup
          files={fastqFiles}
          value={filePath}
          label="FASTQ file"
          emptyText="No FASTQ files in Data yet."
          onchange={(p) => {
            filePath = p;
            const f = fastqFiles.find(f => f.path === p);
            timeoutSec = smartTimeout(f?.size);
          }}
        />

        <div>
          <label for="max-reads" class="flex text-xs text-zinc-500 mb-1.5 items-center">
            Max reads
            <InfoPopup text="Limit analysis to the first N reads. Useful for a quick preview of very large files. Leave blank to analyse all reads." />
            <span class="ml-1 text-zinc-400">(optional)</span>
          </label>
          <input
            id="max-reads"
            data-selectable
            type="number"
            bind:value={maxReads}
            min="1000"
            step="10000"
            placeholder="e.g. 100000"
            class="w-48 rounded-lg border border-border bg-surface-2 px-3 py-2
                   text-sm text-zinc-800 placeholder:text-zinc-400 outline-none
                   focus:border-brand transition-colors"
          />
        </div>

        <div>
          <label for="timeout-sec" class="flex text-xs text-zinc-500 mb-1.5 items-center">
            Timeout
            <InfoPopup text="Maximum time in seconds to wait for the analysis to complete. Auto-set based on file size; increase for large files." />
          </label>
          <div class="flex items-center gap-2">
            <input
              id="timeout-sec"
              type="number"
              bind:value={timeoutSec}
              min="10"
              max="3600"
              step="10"
              class="w-24 rounded-lg border border-border bg-surface-2 px-3 py-2
                     text-sm text-zinc-800 outline-none
                     focus:border-brand transition-colors"
            />
            <span class="text-xs text-zinc-400">seconds</span>
          </div>
        </div>

        <div class="flex items-center gap-3 pt-1">
          <Button
            variant="primary"
            disabled={!filePath || running}
            loading={running}
            onclick={runFastqc}
          >
            Run Analysis
          </Button>
          {#if running && startedAt}
            <span class="text-xs text-zinc-400">
              Elapsed: {fmtDuration(startedAt, now)}
            </span>
          {/if}
        </div>
      </Card>

      <!-- Results -->
      {#if displayError}
        <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono" data-selectable>
          {displayError}
        </div>
      {:else if loadingOutput}
        <div class="flex justify-center py-12">
          <svg class="animate-spin h-5 w-5 text-zinc-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
        </div>
      {:else if loadedOutput}
        <div>
          <p class="mb-2 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Last run result</p>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-xs font-medium text-zinc-700">{selectedRun?.label ?? 'Results'}</h2>
            {#if selectedRun}
              <span class="text-xs text-zinc-400">
                {fmtDate(selectedRun.startedAt)} · {fmtDuration(selectedRun.startedAt, selectedRun.endedAt)}
              </span>
            {/if}
          </div>
          <ToolResultView output={loadedOutput} />
            <RunLog runId={selectedRunId} />
        </div>
      {/if}

    </div>
  </div>
</div>
