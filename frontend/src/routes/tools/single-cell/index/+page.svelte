<!--
	Single-cell Reference Index — the standalone tool page.

	The run itself is `runSimpleafIndex`, shared verbatim with the pipeline step: a tool page and
	a pipeline node differ only in which run they belong to, which is what `nativeOptions` carries.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import TerminalOutput from '$lib/components/ui/TerminalOutput.svelte';
  import RunRecord from '$lib/components/ui/RunRecord.svelte';
  import DepCheck, { type DepStatus } from '$lib/components/ui/DepCheck.svelte';
  import ThreadControl from '$lib/components/tools/ThreadControl.svelte';
  import SingleCellIndexManager from '$lib/components/tools/SingleCellIndexManager.svelte';
  import { DEP_REQUIREMENTS } from '$lib/data/dep-requirements';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { beginDirectNativeToolRun } from '$lib/execution/direct-native-tool';
  import { ensureRunOutputDir } from '$lib/execution/run-storage';
  import { notify } from '$lib/utils/notify';
  import { fmtDuration, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { runSimpleafIndex } from '$lib/tools/single-cell/simpleaf';
  import { threadParam } from '$lib/utils/execution-resources';
  import type { ToolOutput } from '$lib/types/tool-output';

  const TOOL_ID = 'simpleaf-index';

  let depStatus = $state<DepStatus>('checking');

  let genomePath = $state('');
  let annotationPath = $state('');
  let readLength = $state(91);
  let threads = $state(0);
  let running = $state(false);
  let startedAt = $state<number | null>(null);
  let now = $state(Date.now());
  let logLines = $state<string[]>([]);
  let activeExecutionRunId = $state<string | null>(null);

  $effect(() => {
    if (!running) return;
    const id = setInterval(() => now = Date.now(), 1000);
    return () => clearInterval(id);
  });

  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);

  const runs = $derived(analysisRuns.byTool(TOOL_ID));
  const genomeFiles = $derived(dataFiles.byExt('fa', 'fasta', 'fna', 'fa.gz', 'fasta.gz', 'fna.gz'));
  const annotationFiles = $derived(dataFiles.byExt('gtf', 'gtf.gz', 'gff3', 'gff3.gz', 'gff', 'gff.gz'));
  const selectedRun = $derived(runs.find((r) => r.id === selectedRunId) ?? null);
  const selectedRunOutputFiles = $derived(selectedRun?.outputFiles ?? []);
  const displayError = $derived<string | null>(
    selectedRun?.status === 'error' ? (selectedRun.error ?? 'Unknown error') : null
  );

  $effect(() => {
    const id = selectedRunId;
    if (!id) { loadedOutput = null; return; }
    loadingOutput = true;
    analysisRuns.loadOutput(id).then((out) => {
      loadedOutput = out;
      loadingOutput = false;
    });
  });

  onMount(() => {
    dataFiles.init();
    analysisRuns.init();
  });

  function basename(path: string) {
    return path.split(/[\\/]/).pop() ?? path;
  }

  async function runIndex() {
    if (!genomePath || !annotationPath) return;

    running = true;
    selectedRunId = null;
    startedAt = Date.now();
    logLines = [];

    const runId = crypto.randomUUID();
    const t0 = startedAt;
    const label = basename(genomePath);
    const threadInfo = threadParam(threads);
    const inputs = [genomePath, annotationPath];
    const inputSizes = inputs
      .map((path) => dataFiles.files.find((f) => f.path === path)?.size)
      .filter((size): size is number => size != null);
    const params = { readLength, threads: threadInfo.threads, threadsMode: threadInfo.mode };

    const execution = await beginDirectNativeToolRun({
      runId, toolId: TOOL_ID, label, inputs, params, startedAt: t0,
    }).catch(async (error) => {
      await notify('Reference index failed', String(error));
      return null;
    });
    if (!execution) {
      running = false;
      startedAt = null;
      return;
    }
    activeExecutionRunId = runId;

    try {
      const outputDir = await ensureRunOutputDir(runId);
      const result = await runSimpleafIndex(
        {
          genomeFasta: genomePath,
          annotation: annotationPath,
          readLength: String(readLength),
          threads: String(threads),
        },
        outputDir,
        (line) => { if (logLines.length < 500) logLines.push(line); },
        execution,
      );
      for (const file of result.outputFiles) await dataFiles.addToResults(file.path, TOOL_ID);

      const endedAt = Date.now();
      logLines.push(`✓ Index built in ${fmtDuration(t0, endedAt)}`);
      await execution.finalize('done', {
        id: runId, tool: TOOL_ID, label,
        inputs,
        inputSizes: inputSizes.length ? inputSizes : undefined,
        // Genuinely empty: simpleaf is told to put the index and its scratch directory inside
        // this run's own folder, so nothing is written beside the user's genome.
        sideEffects: [],
        params,
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output: result.output ?? null,
        outputFiles: result.outputFiles,
        error: null,
        log: [...logLines],
      });
      await notify('Reference index ready', `${label} indexed in ${fmtDuration(t0, endedAt)}`, endedAt - t0);
    } catch (e) {
      const endedAt = Date.now();
      const cancelled = execution.isCancelled(e);
      const message = cancelled ? 'Index build was cancelled.' : String(e);
      logLines.push(cancelled ? `■ ${message}` : `✗ Error: ${message}`);
      await execution.finalize(cancelled ? 'cancelled' : 'error', {
        id: runId, tool: TOOL_ID, label,
        inputs,
        inputSizes: inputSizes.length ? inputSizes : undefined,
        // Genuinely empty: simpleaf is told to put the index and its scratch directory inside
        // this run's own folder, so nothing is written beside the user's genome.
        sideEffects: [],
        params,
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output: null, error: message,
        log: [...logLines],
      });
      await notify(cancelled ? 'Index build cancelled' : 'Reference index failed', message);
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
    const ok = await confirm({ title: 'Delete run', message: `Delete run for "${label}"?`, confirmLabel: 'Delete' });
    if (!ok) return;
    if (selectedRunId === id) selectedRunId = runs.find((r) => r.id !== id)?.id ?? null;
    await analysisRuns.remove(id);
  }

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="flex h-full overflow-hidden">

  <div class="w-52 shrink-0 border-r border-border bg-surface flex flex-col">
    <div class="flex items-center justify-between px-3 py-3 border-b border-border">
      <span class="text-xs font-medium text-text-secondary">Run history</span>
      {#if runs.length > 0}
        <span class="text-[10px] text-text-subtle">{runs.length}</span>
      {/if}
    </div>
    <div class="flex-1 overflow-y-auto py-1">
      {#if runs.length === 0}
        <p class="text-xs text-text-subtle text-center py-8 px-3 leading-relaxed">No runs yet.<br/>Results will appear here.</p>
      {:else}
        {#each runs as run (run.id)}
          <div class="group relative flex items-start transition-colors {selectedRunId === run.id ? 'bg-brand/8' : 'hover:bg-surface-2'}">
            <button onclick={() => selectedRunId = run.id} class="flex-1 text-left px-3 py-2.5 min-w-0">
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="h-1.5 w-1.5 rounded-full shrink-0 {run.status === 'done' ? 'bg-emerald-500' : 'bg-red-500'}"></span>
                <p class="text-xs font-medium truncate {selectedRunId === run.id ? 'text-brand' : 'text-text-secondary'}">{run.label}</p>
              </div>
              <p class="text-[10px] text-text-subtle pl-3">{fmtDate(run.startedAt)} · {fmtDuration(run.startedAt, run.endedAt)}</p>
            </button>
            <button onclick={() => deleteRun(run.id, run.label)} aria-label="Delete run"
              class="opacity-0 group-hover:opacity-100 p-1.5 mt-2 mr-1.5 shrink-0 text-text-subtle hover:text-red-500 transition-all rounded">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <div class="flex-1 flex flex-col overflow-hidden">
    <PageHeader title="Single-cell Reference Index" description="Build the reference a single-cell experiment is measured against">
      {#snippet actions()}
        <Button variant="ghost" size="sm" onclick={() => goto('/tools')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          Back
        </Button>
      {/snippet}
    </PageHeader>

    <div class="flex-1 overflow-y-auto p-6 space-y-5">

      <SingleCellIndexManager />

      <DepCheck req={DEP_REQUIREMENTS.simpleaf} onStatusChange={(s) => depStatus = s} />

      {#if depStatus === 'ok'}
        <Card class="p-5 space-y-4">
          <div>
            <h2 class="text-sm font-semibold text-text">Build a custom reference</h2>
            <p class="mt-1 text-xs text-text-secondary leading-relaxed">
              An index is what lets Liatir recognise which gene a read came from. Build it once for
              a species and annotation release, then reuse it for every sample. It takes a while and
              needs a few gigabytes of memory; the samples afterwards are fast.
            </p>
          </div>

          <FilePickerPopup
            files={genomeFiles}
            value={genomePath}
            label="Genome FASTA"
            emptyText="No genome FASTA in Data yet."
            disabled={running}
            onchange={(p) => genomePath = p}
          />

          <FilePickerPopup
            files={annotationFiles}
            value={annotationPath}
            label="Annotation (GTF or GFF3)"
            emptyText="No annotation file in Data yet."
            disabled={running}
            onchange={(p) => annotationPath = p}
          />
          <p class="-mt-2 text-[11px] text-text-subtle leading-relaxed">
            The annotation must be the release that goes with this genome. Two releases give results
            that cannot be compared.
          </p>

          <div>
            <label for="read-length" class="block text-xs font-medium text-text-secondary mb-1.5">Read length</label>
            <input
              id="read-length"
              type="number"
              min="20"
              max="1000"
              bind:value={readLength}
              disabled={running}
              class="w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text disabled:opacity-50"
            />
            <p class="mt-1 text-[11px] text-text-subtle">Length of the cDNA read (R2) in the samples this index will be used for. 91 suits 10x 3′ v3.</p>
          </div>

          <ThreadControl value={threads} disabled={running} onchange={(value) => threads = value} />

          <div class="flex items-center gap-3 pt-1">
            <Button
              variant="primary"
              testId="direct-native-run"
              disabled={!genomePath || !annotationPath || running}
              loading={running}
              onclick={runIndex}
            >
              Build index
            </Button>
            {#if running && activeExecutionRunId}
              <Button variant="secondary" testId="direct-native-cancel" onclick={cancelRun}>Cancel</Button>
            {/if}
            {#if running && startedAt}
              <span class="text-xs text-text-subtle">Elapsed: {fmtDuration(startedAt, now)}</span>
            {/if}
          </div>

          <TerminalOutput lines={logLines} {running} />
        </Card>

        {#if displayError}
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono" data-selectable>{sanitizeLocalPathsForDisplay(displayError, 2)}</div>
          <RunRecord runId={selectedRunId} />
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
                <span class="text-xs text-text-subtle">{fmtDate(selectedRun.startedAt)} · {fmtDuration(selectedRun.startedAt, selectedRun.endedAt)}</span>
              {/if}
            </div>
            <ToolResultView output={loadedOutput} outputFiles={selectedRunOutputFiles} />
            <RunRecord runId={selectedRunId} />
          </div>
        {/if}
      {/if}

    </div>
  </div>
</div>
