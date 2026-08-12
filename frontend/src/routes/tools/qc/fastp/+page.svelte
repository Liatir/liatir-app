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
  import { parseFastpJson, fastpToToolOutput } from '$lib/tools/qc/fastp';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import TerminalOutput from '$lib/components/ui/TerminalOutput.svelte';
  import { notify } from '$lib/utils/notify';
  import RunLog from '$lib/components/ui/RunLog.svelte';
  import DepCheck, { type DepStatus } from '$lib/components/ui/DepCheck.svelte';
  import ThreadControl from '$lib/components/tools/ThreadControl.svelte';
  import { DEP_REQUIREMENTS } from '$lib/data/dep-requirements';
  import { threadParam } from '$lib/utils/execution-resources';
  import type { ToolOutput } from '$lib/types/tool-output';
  import type { RunOutputFile } from '$lib/types/pipeline';

  // ── dep check ────────────────────────────────────────────────────
  let depStatus = $state<DepStatus>('checking');

  // ── form state ───────────────────────────────────────────────────
  let r1Path      = $state('');
  let r2Path      = $state('');
  let threads     = $state(0);
  let running     = $state(false);
  let startedAt   = $state<number | null>(null);
  let logLines    = $state<string[]>([]);
  let now         = $state(Date.now());
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

  const fastpRuns = $derived(analysisRuns.byTool('fastp'));
  const fastqFiles = $derived(dataFiles.byExt('fastq', 'fastq.gz', 'fq', 'fq.gz'));
  const selectedRun = $derived(fastpRuns.find(r => r.id === selectedRunId) ?? null);
  const selectedRunOutputFiles = $derived(selectedRun?.outputFiles ?? []);
  const displayError = $derived<string | null>(
    selectedRun?.status === 'error' ? (selectedRun.error ?? 'Unknown error') : null
  );
  const isPaired = $derived(r2Path !== '');

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
  async function runFastp() {
    if (!r1Path) return;

    running = true;
    selectedRunId = null;
    startedAt = Date.now();

    const runId = crypto.randomUUID();
    const r1Name = r1Path.split(/[\\/]/).pop() ?? r1Path;
    const label = isPaired ? `${r1Name} (paired)` : r1Name;
    const t0 = startedAt;
    const threadInfo = threadParam(threads);

    const r1Size = dataFiles.files.find(f => f.path === r1Path)?.size;
    const r2Size = isPaired ? dataFiles.files.find(f => f.path === r2Path)?.size : undefined;
    const inputSizes = [r1Size, r2Size].filter((s): s is number => s != null);
    const inputs = isPaired ? [r1Path, r2Path] : [r1Path];
    const params = { paired: isPaired, threads: threadInfo.threads, threadsMode: threadInfo.mode };

    const api = liatir();
    const execution = await beginDirectNativeToolRun({
      runId,
      toolId: 'fastp',
      label,
      inputs,
      params,
      startedAt: t0,
    }).catch(async (error) => {
      await notify('fastp failed', String(error));
      return null;
    });
    if (!execution) {
      running = false;
      startedAt = null;
      return;
    }
    activeExecutionRunId = runId;

    try {
      const paths = await api!.invoke('lia_fs_paths', {}) as { data: string; cache: string };
      const base = `${paths.data}/tool-outputs`;
      const jsonPath = `${base}/fastp-${runId}.json`;
      const out1Path = `${base}/fastp-${runId}-R1.fastq.gz`;
      const out2Path = `${base}/fastp-${runId}-R2.fastq.gz`;

      const args = [
        '--in1', r1Path,
        '--out1', out1Path,
        '--json', jsonPath,
        '--html', '/dev/null',
        '--thread', String(threadInfo.threads),
      ];
      if (isPaired) {
        args.push('--in2', r2Path, '--out2', out2Path);
      }

      logLines = [`$ fastp --thread ${threadInfo.threads} --in1 ${r1Path.split(/[\\/]/).pop()}${r2Path ? ' --in2 ' + r2Path.split(/[\\/]/).pop() : ''}`];
      const result = await runNativeTool(
        'fastp',
        args,
        undefined,
        (line) => { if (line.trim()) logLines.push(line); },
        execution.nativeOptions(),
      );

      if (!result.ok) {
        throw new Error(result.stderr || `fastp exited with code ${result.exitCode}`);
      }

      const jsonText = await api!.invoke('lia_read_file_text', { path: jsonPath }) as string;
      const parsed = parseFastpJson(jsonText);
      const output = fastpToToolOutput(parsed);
      const endedAt = Date.now();

      // Collect output files
      const outputFiles: RunOutputFile[] = [];
      const trySize = async (p: string) => { try { return await api!.invoke('lia_file_size', { path: p }) as number; } catch { return undefined; } };
      outputFiles.push({ label: 'Trimmed R1', path: out1Path, ext: 'fastq.gz', size: await trySize(out1Path) });
      if (isPaired) {
        outputFiles.push({ label: 'Trimmed R2', path: out2Path, ext: 'fastq.gz', size: await trySize(out2Path) });
      }

      await execution.finalize('done', {
        id: runId, tool: 'fastp', label,
        inputs,
        inputSizes: inputSizes.length > 0 ? inputSizes : undefined,
        params,
        outputFiles,
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output, error: null,
        log: [...logLines],
      });
      await notify('fastp complete', `${label} finished in ${fmtDuration(t0, endedAt)}`, endedAt - t0);
    } catch (e) {
      const endedAt = Date.now();
      const cancelled = execution.isCancelled(e);
      const message = cancelled ? 'fastp run was cancelled.' : String(e);
      logLines.push(cancelled ? `■ ${message}` : `✗ Error: ${message}`);
      await execution.finalize(cancelled ? 'cancelled' : 'error', {
        id: runId, tool: 'fastp', label,
        inputs,
        inputSizes: inputSizes.length > 0 ? inputSizes : undefined,
        params,
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output: null, error: message,
        log: [...logLines],
      });
      await notify(cancelled ? 'fastp cancelled' : 'fastp failed', message);
    } finally {
      running   = false;
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
      selectedRunId = fastpRuns.find(r => r.id !== id)?.id ?? null;
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
      {#if fastpRuns.length > 0}
        <span class="text-[10px] text-text-subtle">{fastpRuns.length}</span>
      {/if}
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if fastpRuns.length === 0}
        <p class="text-xs text-text-subtle text-center py-8 px-3 leading-relaxed">
          No runs yet.<br />Results will appear here.
        </p>
      {:else}
        {#each fastpRuns as run (run.id)}
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
      title="fastp"
      description="FASTQ quality trimming and filtering"
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

      <DepCheck req={DEP_REQUIREMENTS.fastp} onStatusChange={(s) => depStatus = s} />

      {#if depStatus === 'ok'}
        <Card class="p-5 space-y-4">
          <h2 class="text-sm font-semibold text-text">trim &amp; filter</h2>

              <div class="flex items-start gap-2.5 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <svg class="shrink-0 mt-0.5" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p class="text-[11px] text-blue-800 leading-relaxed">Processing time depends on file size — large FASTQ files (10+ GB) may take several minutes.</p>
              </div>

          <FilePickerPopup
            files={fastqFiles}
            value={r1Path}
            label="R1 — FASTQ file (required)"
            placeholder="Select R1 file…"
            emptyText="No FASTQ files in Data yet."
            disabled={running}
            onchange={(p) => r1Path = p}
          />

          <div>
            <FilePickerPopup
              files={fastqFiles}
              value={r2Path}
              label="R2 — FASTQ file (optional, for paired-end)"
              placeholder="Select R2 file… (leave empty for single-end)"
              emptyText="No FASTQ files in Data yet."
              disabled={running}
              onchange={(p) => r2Path = p}
            />
            {#if isPaired}
              <p class="text-[11px] text-emerald-600 mt-1.5">Paired-end mode</p>
            {:else}
              <p class="text-[11px] text-text-subtle mt-1.5">Single-end mode — add R2 for paired-end</p>
            {/if}
          </div>

          <ThreadControl value={threads} disabled={running} onchange={(value) => threads = value} />

          <div class="flex items-center gap-3 pt-1">
            <Button
              variant="primary"
              testId="direct-native-run"
              disabled={!r1Path || running}
              loading={running}
              onclick={runFastp}
            >
              Run fastp
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
            <ToolResultView output={loadedOutput} outputFiles={selectedRunOutputFiles} />
            <RunLog runId={selectedRunId} />
          </div>
        {/if}
      {/if}

    </div>
  </div>
</div>
