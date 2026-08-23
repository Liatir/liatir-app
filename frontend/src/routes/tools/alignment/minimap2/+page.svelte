<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import TerminalOutput from '$lib/components/ui/TerminalOutput.svelte';
  import RunLog from '$lib/components/ui/RunLog.svelte';
  import DepCheck, { type DepStatus } from '$lib/components/ui/DepCheck.svelte';
  import ThreadControl from '$lib/components/tools/ThreadControl.svelte';
  import { DEP_REQUIREMENTS } from '$lib/data/dep-requirements';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { beginDirectNativeToolRun } from '$lib/execution/direct-native-tool';
  import { runNativeTool } from '$lib/utils/native-tool';
  import { ensureRunOutputsDir } from '$lib/utils/results';
  import { notify } from '$lib/utils/notify';
  import { fmtDuration, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { liatir } from '$lib/api';
  import { MINIMAP2_PRESETS, parseMinimap2Stats, minimap2ToToolOutput, type Minimap2Preset } from '$lib/tools/alignment/minimap2';
  import { threadParam } from '$lib/utils/execution-resources';
  import type { ToolOutput } from '$lib/types/tool-output';
  import type { RunOutputFile } from '$lib/stores/analysisRuns.svelte';

  // ── dep check ────────────────────────────────────────────────────
  let depStatus = $state<DepStatus>('checking');

  // ── form state ───────────────────────────────────────────────────
  let preset     = $state<Minimap2Preset>('sr');
  let refPath    = $state('');
  let r1Path     = $state('');
  let threads    = $state(0);
  let running    = $state(false);
  let startedAt  = $state<number | null>(null);
  let now        = $state(Date.now());
  let logLines   = $state<string[]>([]);
  let activeExecutionRunId = $state<string | null>(null);

  $effect(() => {
    if (!running) return;
    const id = setInterval(() => now = Date.now(), 1000);
    return () => clearInterval(id);
  });

  // ── history ──────────────────────────────────────────────────────
  let selectedRunId  = $state<string | null>(null);
  let loadedOutput   = $state<ToolOutput | null>(null);
  let loadingOutput  = $state(false);

  const mm2Runs    = $derived(analysisRuns.byTool('minimap2'));
  const fastaFiles  = $derived(dataFiles.byExt('fa', 'fasta', 'fa.gz', 'fasta.gz', 'mmi'));
  const readFiles   = $derived(dataFiles.byExt('fastq', 'fq', 'fastq.gz', 'fq.gz', 'fa', 'fasta'));
  const selectedRun = $derived(mm2Runs.find(r => r.id === selectedRunId) ?? null);
  const selectedRunOutputFiles = $derived(selectedRun?.outputFiles ?? []);
  const displayError = $derived<string | null>(
    selectedRun?.status === 'error' ? (selectedRun.error ?? 'Unknown error') : null
  );
  const selectedPreset = $derived(MINIMAP2_PRESETS.find(p => p.value === preset));

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
  async function runMinimap2() {
    if (!refPath || !r1Path) return;
    const api = liatir();
    if (!api) return;

    running = true;
    selectedRunId = null;
    startedAt = Date.now();

    const runId   = crypto.randomUUID();
    const refName = refPath.split(/[\\/]/).pop() ?? refPath;
    const r1Name  = r1Path.split(/[\\/]/).pop() ?? r1Path;
    const t0 = startedAt;
    const threadInfo = threadParam(threads);
    const inputSizes = [
      dataFiles.files.find(f => f.path === refPath)?.size,
      dataFiles.files.find(f => f.path === r1Path)?.size,
    ].filter((s): s is number => s != null);
    const params = { preset, threads: threadInfo.threads, threadsMode: threadInfo.mode };
    const execution = await beginDirectNativeToolRun({
      runId,
      toolId: 'minimap2',
      label: r1Name,
      inputs: [refPath, r1Path],
      params,
      startedAt: t0,
    }).catch(async (error) => {
      await notify('Minimap2 failed', String(error));
      return null;
    });
    if (!execution) {
      running = false;
      startedAt = null;
      return;
    }
    activeExecutionRunId = runId;

    try {
      const outPath = `${await ensureRunOutputsDir(runId)}/aligned.sam`;
      logLines = [
        `$ minimap2 -t ${threadInfo.threads} -ax ${preset} ${refName} ${r1Name}`,
        `→ Output: minimap2-${runId}.sam`,
      ];

      const result = await runNativeTool(
        'minimap2',
        ['-t', String(threadInfo.threads), '-ax', preset, refPath, r1Path],
        undefined,
        (line) => { if (line.trim() && logLines.length < 500) logLines.push(line); },
        execution.nativeOptions({ stdoutPath: outPath }),
      );

      if (!result.ok) {
        throw new Error(result.stderr || `minimap2 exited with code ${result.exitCode}`);
      }

      const outSize = await api.invoke('lia_file_size', { path: outPath }) as number;
      await dataFiles.addToResults(outPath, 'minimap2');

      const stderrLines = result.stderr.split(/\r?\n/).filter(Boolean);
      const stats = parseMinimap2Stats(stderrLines);
      const output = minimap2ToToolOutput(stats, result.stderr, outPath, preset);
      const endedAt = Date.now();
      logLines.push(`✓ Done in ${fmtDuration(t0, endedAt)} — ${(outSize / 1_048_576).toFixed(1)} MB`);

      const outputFiles: RunOutputFile[] = [{ label: 'Output SAM', path: outPath, ext: 'sam', size: outSize }];

      await execution.finalize('done', {
        id: runId, tool: 'minimap2', label: r1Name,
        inputs: [refPath, r1Path],
        inputSizes: inputSizes.length ? inputSizes : undefined,
        // minimap2 writes the one SAM it was asked for and nothing else.
        sideEffects: [],
        params,
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output, outputFiles, error: null,
        log: [...logLines],
      });
      await notify('Minimap2 complete', `${r1Name} aligned in ${fmtDuration(t0, endedAt)}`, endedAt - t0);
    } catch (e) {
      const endedAt = Date.now();
      const cancelled = execution.isCancelled(e);
      const message = cancelled ? 'Minimap2 run was cancelled.' : String(e);
      logLines.push(cancelled ? `■ ${message}` : `✗ Error: ${message}`);
      await execution.finalize(cancelled ? 'cancelled' : 'error', {
        id: runId, tool: 'minimap2', label: r1Name,
        inputs: [refPath, r1Path],
        inputSizes: inputSizes.length ? inputSizes : undefined,
        sideEffects: [],
        params,
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output: null, error: message,
        log: [...logLines],
      });
      await notify(cancelled ? 'Minimap2 cancelled' : 'Minimap2 failed', message);
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
    if (selectedRunId === id) selectedRunId = mm2Runs.find(r => r.id !== id)?.id ?? null;
    await analysisRuns.remove(id);
  }

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="flex h-full overflow-hidden">

  <!-- Run history sidebar -->
  <div class="w-52 shrink-0 border-r border-border bg-surface flex flex-col">
    <div class="flex items-center justify-between px-3 py-3 border-b border-border">
      <span class="text-xs font-medium text-text-secondary">Run history</span>
      {#if mm2Runs.length > 0}
        <span class="text-[10px] text-text-subtle">{mm2Runs.length}</span>
      {/if}
    </div>
    <div class="flex-1 overflow-y-auto py-1">
      {#if mm2Runs.length === 0}
        <p class="text-xs text-text-subtle text-center py-8 px-3 leading-relaxed">No runs yet.<br/>Results will appear here.</p>
      {:else}
        {#each mm2Runs as run (run.id)}
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

  <!-- Main content -->
  <div class="flex-1 flex flex-col overflow-hidden">
    <PageHeader title="Minimap2" description="Versatile alignment for long and short reads">
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

      <DepCheck req={DEP_REQUIREMENTS.minimap2} onStatusChange={(s) => depStatus = s} />

      {#if depStatus === 'ok'}
        <Card class="p-5 space-y-4">
          <h2 class="text-sm font-semibold text-text">minimap2 -ax</h2>

          <!-- Preset selector -->
          <div class="space-y-1.5">
            <span class="text-[11px] text-text-muted">Preset</span>
            <div class="flex flex-wrap gap-1.5">
              {#each MINIMAP2_PRESETS as p}
                <button
                  onclick={() => preset = p.value}
                  title={p.description}
                  class="px-2.5 py-1 rounded-md border text-xs transition-colors
                    {preset === p.value
                      ? 'bg-brand text-white border-brand'
                      : 'bg-surface border-border text-text-secondary hover:border-brand/40'}"
                >
                  {p.label}
                </button>
              {/each}
            </div>
            {#if selectedPreset}
              <p class="text-[10px] text-text-subtle">{selectedPreset.description}</p>
            {/if}
          </div>

          <FilePickerPopup
            files={fastaFiles}
            value={refPath}
            label="Reference FASTA / MMI index"
            emptyText="No FASTA/MMI files in Data yet."
            disabled={running}
            onchange={(p) => refPath = p}
          />

          <FilePickerPopup
            files={readFiles}
            value={r1Path}
            label="Reads (FASTQ or FASTA)"
            emptyText="No read files in Data yet."
            disabled={running}
            onchange={(p) => r1Path = p}
          />

          <ThreadControl value={threads} disabled={running} onchange={(value) => threads = value} />

          <div class="flex items-center gap-3 pt-1">
            <Button
              variant="primary"
              testId="direct-native-run"
              disabled={!refPath || !r1Path || running}
              loading={running}
              onclick={runMinimap2}
            >
              Run alignment
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
            <RunLog runId={selectedRunId} />
          </div>
        {/if}
      {/if}

    </div>
  </div>
</div>
