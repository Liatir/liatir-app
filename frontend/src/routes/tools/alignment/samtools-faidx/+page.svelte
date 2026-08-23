<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import { liatir } from '$lib/api';
  import { fmtDuration, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { beginDirectNativeToolRun } from '$lib/execution/direct-native-tool';
  import { runNativeTool } from '$lib/utils/native-tool';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import TerminalOutput from '$lib/components/ui/TerminalOutput.svelte';
  import { notify } from '$lib/utils/notify';
  import RunRecord from '$lib/components/ui/RunRecord.svelte';
  import DepCheck, { type DepStatus } from '$lib/components/ui/DepCheck.svelte';
  import ThreadControl from '$lib/components/tools/ThreadControl.svelte';
  import { DEP_REQUIREMENTS } from '$lib/data/dep-requirements';
  import { threadParam } from '$lib/utils/execution-resources';
  import type { ToolOutput, StatsSection, TextSection, TableSection } from '$lib/types/tool-output';
  import type { RunOutputFile } from '$lib/types/pipeline';

  // ── dep check ────────────────────────────────────────────────────
  let depStatus = $state<DepStatus>('checking');

  // ── index form ───────────────────────────────────────────────────
  let filePath  = $state('');
  let threads   = $state(0);
  let running   = $state(false);
  let startedAt = $state<number | null>(null);
  let now       = $state(Date.now());
  let logLines  = $state<string[]>([]);
  let activeIndexExecutionRunId = $state<string | null>(null);

  $effect(() => {
    if (!running) return;
    const id = setInterval(() => now = Date.now(), 1000);
    return () => clearInterval(id);
  });

  // ── extract form ─────────────────────────────────────────────────
  let extractRegion  = $state('');
  let extractRunning = $state(false);
  let extractOutput  = $state<string | null>(null);
  let extractError   = $state<string | null>(null);
  let activeExtractExecutionRunId = $state<string | null>(null);

  // ── history ──────────────────────────────────────────────────────
  let selectedRunId = $state<string | null>(null);
  let loadedOutput  = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);

  const faidxRuns   = $derived(analysisRuns.byTool('samtools-faidx'));
  const fastaFiles  = $derived(dataFiles.byExt('fasta', 'fa', 'fna', 'faa', 'fasta.gz', 'fa.gz', 'fna.gz'));
  const selectedRun = $derived(faidxRuns.find(r => r.id === selectedRunId) ?? null);
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

  // ── run faidx (index creation) ───────────────────────────────────
  async function runFaidx() {
    if (!filePath) return;

    running   = true;
    selectedRunId = null;
    startedAt = Date.now();

    const runId    = crypto.randomUUID();
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const t0       = startedAt;
    const fileSize = dataFiles.files.find(f => f.path === filePath)?.size;
    const inputSizes = fileSize != null ? [fileSize] : undefined;
    const threadInfo = threadParam(threads);
    const params = { subcommand: 'faidx', threads: threadInfo.threads, threadsMode: threadInfo.mode };
    const execution = await beginDirectNativeToolRun({
      runId,
      toolId: 'samtools-faidx',
      label: fileName,
      inputs: [filePath],
      params,
      startedAt: t0,
    }).catch(async (error) => {
      await notify('Samtools faidx failed', String(error));
      return null;
    });
    if (!execution) {
      running = false;
      startedAt = null;
      return;
    }
    activeIndexExecutionRunId = runId;

    try {
      logLines = [`$ samtools faidx -@ ${threadInfo.threads} ${fileName}`];
      // samtools faidx writes the index to <file>.fai (no stdout output)
      const result = await runNativeTool(
        'samtools',
        ['faidx', '-@', String(threadInfo.threads), filePath],
        undefined,
        (line) => { if (line.trim()) logLines.push(line); },
        execution.nativeOptions(),
      );

      if (!result.ok) {
        throw new Error(result.stderr || `samtools faidx exited with code ${result.exitCode}`);
      }

      // Read the generated .fai file to display sequence table
      const api = liatir();
      if (!api) throw new Error('Liatir API not available');

      const faiPath = `${filePath}.fai`;
      const faiText = await api.invoke('lia_read_file_text', { path: faiPath }) as string;
      const output  = parseFaiToToolOutput(faiText, faiPath);
      const endedAt = Date.now();

      // Register the .fai file in Data under the locked Results/<tool>/ folder
      await dataFiles.addToResults(faiPath, 'samtools-faidx');
      const outputFiles: RunOutputFile[] = [{
        label: 'FASTA index',
        path: faiPath,
        ext: 'fai',
        size: await api.invoke('lia_file_size', { path: faiPath }) as number,
      }];

      // Indexing a bgzip-compressed FASTA writes a second index beside the first. It is samtools'
      // doing, not the user's request, and it appears next to their own file — so it is declared.
      // Probed rather than assumed: the file exists only for compressed input.
      const gziPath = `${filePath}.gzi`;
      const sideEffects: RunOutputFile[] = [];
      try {
        const gziSize = await api.invoke('lia_file_size', { path: gziPath }) as number;
        sideEffects.push({ label: 'BGZF index', path: gziPath, ext: 'gzi', size: gziSize });
      } catch { /* uncompressed input: samtools writes no .gzi */ }

      await execution.finalize('done', {
        id: runId, tool: 'samtools-faidx', label: fileName,
        inputs: [filePath], inputSizes,
        params,
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output, outputFiles, sideEffects, error: null,
        log: [...logLines],
      });
      await notify('Samtools faidx complete', `${fileName} finished in ${fmtDuration(t0, endedAt)}`, endedAt - t0);
    } catch (e) {
      const endedAt = Date.now();
      const cancelled = execution.isCancelled(e);
      const message = cancelled ? 'Samtools faidx run was cancelled.' : String(e);
      logLines.push(cancelled ? `■ ${message}` : `✗ Error: ${message}`);
      await execution.finalize(cancelled ? 'cancelled' : 'error', {
        id: runId, tool: 'samtools-faidx', label: fileName,
        inputs: [filePath], inputSizes,
        // Indexing failed, so nothing beside the user's FASTA was written.
        sideEffects: [],
        params,
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output: null, error: message,
        log: [...logLines],
      });
      await notify(cancelled ? 'Samtools faidx cancelled' : 'Samtools faidx failed', message);
    } finally {
      running   = false;
      startedAt = null;
      activeIndexExecutionRunId = null;
      selectedRunId = runId;
    }
  }

  // ── run faidx (subsequence extract) ─────────────────────────────
  async function extractSubsequence() {
    if (!filePath || !extractRegion.trim()) return;
    extractRunning = true;
    extractOutput  = null;
    extractError   = null;
    const runId = crypto.randomUUID();
    const started = Date.now();
    const region = extractRegion.trim();
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const threadInfo = threadParam(threads);
    const params = { subcommand: 'faidx-extract', region, threads: threadInfo.threads, threadsMode: threadInfo.mode };
    const execution = await beginDirectNativeToolRun({
      runId,
      toolId: 'samtools-faidx',
      label: `${fileName} · ${region}`,
      inputs: [filePath],
      params,
      startedAt: started,
    }).catch(async (error) => {
      extractError = String(error);
      return null;
    });
    if (!execution) {
      extractRunning = false;
      return;
    }
    activeExtractExecutionRunId = runId;

    try {
      logLines = [`$ samtools faidx -@ ${threadInfo.threads} ${fileName} ${region}`];
      const result = await runNativeTool(
        'samtools',
        ['faidx', '-@', String(threadInfo.threads), filePath, region],
        undefined,
        (line) => { if (line.trim()) logLines.push(line); },
        execution.nativeOptions({ label: `${fileName} · ${region}` }),
      );
      if (!result.ok && result.stdout.trim() === '') {
        throw new Error(result.stderr || `samtools faidx exited with code ${result.exitCode}`);
      }
      extractOutput = result.stdout;
      const endedAt = Date.now();
      await execution.finalize('done', {
        id: runId,
        tool: 'samtools-faidx',
        label: `${fileName} · ${region}`,
        inputs: [filePath],
        // Extracting a subsequence prints it; it writes nothing.
        sideEffects: [],
        params,
        startedAt: started,
        endedAt,
        durationMs: endedAt - started,
        output: {
          sections: [{ type: 'text', label: 'Extracted subsequence', content: result.stdout, mono: true }],
        },
        error: null,
        log: [...logLines],
      });
      selectedRunId = runId;
    } catch (e) {
      const endedAt = Date.now();
      const cancelled = execution.isCancelled(e);
      const message = cancelled ? 'Subsequence extraction was cancelled.' : String(e);
      extractError = message;
      await execution.finalize(cancelled ? 'cancelled' : 'error', {
        id: runId,
        tool: 'samtools-faidx',
        label: `${fileName} · ${region}`,
        inputs: [filePath],
        sideEffects: [],
        params,
        startedAt: started,
        endedAt,
        durationMs: endedAt - started,
        output: null,
        error: message,
        log: [...logLines, cancelled ? `■ ${message}` : `✗ Error: ${message}`],
      });
      selectedRunId = runId;
    } finally {
      extractRunning = false;
      activeExtractExecutionRunId = null;
    }
  }

  async function cancelIndexRun() {
    if (activeIndexExecutionRunId) await executionRuns.cancel(activeIndexExecutionRunId);
  }

  async function cancelExtractRun() {
    if (activeExtractExecutionRunId) await executionRuns.cancel(activeExtractExecutionRunId);
  }

  function parseFaiToToolOutput(faiText: string, faiPath: string): ToolOutput {
    const lines = faiText.split('\n').filter(l => l.trim());
    const rows = lines.map(line => {
      const [name, lenStr, , basesPerLine, bytesPerLine] = line.split('\t');
      const len = parseInt(lenStr ?? '0', 10);
      return { name: name ?? '', length: len };
    });

    const totalBases = rows.reduce((s, r) => s + r.length, 0);

    const stats: StatsSection = {
      type: 'stats',
      cols: 3,
      items: [
        { label: 'Sequences', value: rows.length.toLocaleString(), description: 'Total number of sequences in the FASTA' },
        { label: 'Total bases', value: fmtLen(totalBases), description: `${totalBases.toLocaleString()} bp` },
        { label: 'Index file', value: faiPath.split(/[\\/]/).pop() ?? faiPath, description: 'Created next to the FASTA file' },
      ],
    };

    const table: TableSection = {
      type: 'table',
      label: 'Sequences',
      headers: ['Name', 'Length'],
      rows: rows.map(r => [r.name, fmtLen(r.length)]),
    };

    return { sections: [stats, table] };
  }

  function fmtLen(n: number): string {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} Gb`;
    if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)} Mb`;
    if (n >= 1_000)         return `${(n / 1_000).toFixed(1)} Kb`;
    return `${n} bp`;
  }

  async function deleteRun(id: string, label: string) {
    const ok = await confirm({
      title: 'Delete run',
      message: `Delete the run for "${label}"?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    if (selectedRunId === id) {
      selectedRunId = faidxRuns.find(r => r.id !== id)?.id ?? null;
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
      {#if faidxRuns.length > 0}
        <span class="text-[10px] text-text-subtle">{faidxRuns.length}</span>
      {/if}
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if faidxRuns.length === 0}
        <p class="text-xs text-text-subtle text-center py-8 px-3 leading-relaxed">
          No runs yet.<br />Results will appear here.
        </p>
      {:else}
        {#each faidxRuns as run (run.id)}
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
      title="Samtools faidx"
      description="Index FASTA files and extract subsequences by coordinate"
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

      <DepCheck req={DEP_REQUIREMENTS.samtools} onStatusChange={(s) => depStatus = s} />

      {#if depStatus === 'ok'}
        <!-- Index card -->
        <Card class="p-5 space-y-4">
          <h2 class="text-sm font-semibold text-text">faidx — Create index</h2>

          <p class="text-xs text-text-muted leading-relaxed">
            Creates a <code class="font-mono">.fai</code> index file next to the FASTA.
            Required for random-access queries and many downstream tools.
          </p>

          <FilePickerPopup
            files={fastaFiles}
            value={filePath}
            label="FASTA file"
            emptyText="No FASTA files in Data yet."
            disabled={running}
            onchange={(p) => filePath = p}
          />

          <ThreadControl value={threads} disabled={running || extractRunning} onchange={(value) => threads = value} />

          <div class="flex items-center gap-3 pt-1">
            <Button
              variant="primary"
              testId="direct-native-run"
              disabled={!filePath || running || extractRunning}
              loading={running}
              onclick={runFaidx}
            >
              Create index
            </Button>
            {#if running && activeIndexExecutionRunId}
              <Button variant="secondary" testId="direct-native-cancel" onclick={cancelIndexRun}>Cancel</Button>
            {/if}
            {#if running && startedAt}
              <span class="text-xs text-text-subtle">Elapsed: {fmtDuration(startedAt, now)}</span>
            {/if}
          </div>
          <TerminalOutput lines={logLines} {running} />
        </Card>

        <!-- Extract card — only shown when a file is selected -->
        {#if filePath}
          <Card class="p-5 space-y-4">
            <h2 class="text-sm font-semibold text-text">faidx — Extract subsequence</h2>
            <p class="text-xs text-text-muted leading-relaxed">
              Requires an existing <code class="font-mono">.fai</code> index.
              Use the region format <code class="font-mono">chr:start-end</code> (1-based, inclusive).
            </p>

            <div class="space-y-1">
              <label for="samtools-faidx-region" class="text-xs font-medium text-text-secondary">Region</label>
              <input
                id="samtools-faidx-region"
                type="text"
                bind:value={extractRegion}
                disabled={extractRunning}
                placeholder="e.g. chr1:1000-2000"
                class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm
                       placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-brand/30
                       disabled:opacity-50"
              />
            </div>

            <Button
              variant="secondary"
              testId="direct-native-extract-run"
              disabled={!extractRegion.trim() || extractRunning || running}
              loading={extractRunning}
              onclick={extractSubsequence}
            >
              Extract
            </Button>
            {#if extractRunning && activeExtractExecutionRunId}
              <Button variant="secondary" testId="direct-native-extract-cancel" onclick={cancelExtractRun}>Cancel</Button>
            {/if}

            {#if extractError}
              <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 font-mono">
                {sanitizeLocalPathsForDisplay(extractError, 2)}
              </div>
            {:else if extractOutput}
              <div class="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-text-secondary whitespace-pre overflow-x-auto max-h-64">
                {extractOutput}
              </div>
            {/if}
          </Card>
        {/if}

        <!-- Run results -->
        {#if displayError}
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono">
            {sanitizeLocalPathsForDisplay(displayError, 2)}
          </div>
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
                <span class="text-xs text-text-subtle">
                  {fmtDate(selectedRun.startedAt)} · {fmtDuration(selectedRun.startedAt, selectedRun.endedAt)}
                </span>
              {/if}
            </div>
            <ToolResultView output={loadedOutput} />
            <RunRecord runId={selectedRunId} />
          </div>
        {/if}
      {/if}

    </div>
  </div>
</div>
