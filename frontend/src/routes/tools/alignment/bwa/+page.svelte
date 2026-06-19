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
  import { DEP_REQUIREMENTS } from '$lib/data/dep-requirements';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { notify } from '$lib/utils/notify';
  import { fmtDuration } from '$lib/utils';
  import { liatir } from '$lib/api';
  import { parseBwaMemStats, bwaMemToToolOutput } from '$lib/tools/alignment/bwa';
  import type { ToolOutput } from '$lib/types/tool-output';
  import type { RunOutputFile } from '$lib/stores/analysisRuns.svelte';

  // ── dep check ────────────────────────────────────────────────────
  let depStatus = $state<DepStatus>('checking');

  // ── form state ───────────────────────────────────────────────────
  let refPath    = $state('');
  let r1Path     = $state('');
  let r2Path     = $state('');
  let running    = $state(false);
  let startedAt  = $state<number | null>(null);
  let now        = $state(Date.now());
  let logLines   = $state<string[]>([]);

  $effect(() => {
    if (!running) return;
    const id = setInterval(() => now = Date.now(), 1000);
    return () => clearInterval(id);
  });

  // ── history ──────────────────────────────────────────────────────
  let selectedRunId  = $state<string | null>(null);
  let loadedOutput   = $state<ToolOutput | null>(null);
  let loadingOutput  = $state(false);

  const bwaRuns   = $derived(analysisRuns.byTool('bwa'));
  const fastaFiles = $derived(dataFiles.byExt('fa', 'fasta', 'fa.gz', 'fasta.gz'));
  const fastqFiles = $derived(dataFiles.byExt('fastq', 'fq', 'fastq.gz', 'fq.gz'));
  const selectedRun = $derived(bwaRuns.find(r => r.id === selectedRunId) ?? null);
  const selectedRunOutputFiles = $derived(selectedRun?.outputFiles ?? []);
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
    analysisRuns.init().then(() => {
      if (bwaRuns.length > 0 && selectedRunId === null) {
        selectedRunId = bwaRuns[0].id;
      }
    });
  });

  // ── run ──────────────────────────────────────────────────────────
  async function runBwa() {
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
    const inputSizes = [
      dataFiles.files.find(f => f.path === refPath)?.size,
      dataFiles.files.find(f => f.path === r1Path)?.size,
      r2Path ? dataFiles.files.find(f => f.path === r2Path)?.size : undefined,
    ].filter((s): s is number => s != null);

    let offStderr: (() => void) | undefined;

    try {
      const { data: dataDir } = await api.invoke('lia_fs_paths') as { data: string; cache: string };
      const outPath = `${dataDir}/tool-outputs/bwa-${runId}.sam`;
      const jid = `bwa-${runId}`;

      const label = r2Path ? `${r1Name} + R2` : r1Name;
      logLines = [
        `$ bwa mem ${refName} ${r1Name}${r2Path ? ` ${r2Path.split(/[\\/]/).pop()}` : ''}`,
        `→ Output: bwa-${runId}.sam`,
      ];

      offStderr = await api.desktop.events.on(`jobs:stderr:${jid}`, (line: string) => {
        if (typeof line === 'string' && line.trim() && logLines.length < 500) logLines.push(line);
      }) as unknown as () => void;

      const result = await api.invoke('lia_bwa_mem', {
        reference: refPath,
        readsR1: r1Path,
        readsR2: r2Path || null,
        outputSam: outPath,
        jobId: jid,
      } as any) as { ok: boolean; exitCode: number | null; stderr: string[] };

      if (!result.ok) {
        throw new Error(result.stderr.slice(-10).join('\n') || `bwa exited with code ${result.exitCode}`);
      }

      const outSize = await api.invoke('lia_file_size', { path: outPath }) as number;
      await dataFiles.add(outPath);

      const stats = parseBwaMemStats(result.stderr);
      const output = bwaMemToToolOutput(stats, result.stderr.join('\n'), outPath);
      const endedAt = Date.now();
      logLines.push(`✓ Done in ${fmtDuration(t0, endedAt)} — ${(outSize / 1_048_576).toFixed(1)} MB`);

      const outputFiles: RunOutputFile[] = [{ label: 'Output SAM', path: outPath, ext: 'sam', size: outSize }];

      await analysisRuns.add({
        id: runId, tool: 'bwa', label,
        inputs: [refPath, r1Path, ...(r2Path ? [r2Path] : [])],
        inputSizes: inputSizes.length ? inputSizes : undefined,
        params: { paired: !!r2Path },
        status: 'done',
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output, outputFiles, error: null,
        log: [...logLines],
      });
      await notify('BWA-MEM complete', `${label} aligned in ${fmtDuration(t0, endedAt)}`, endedAt - t0);
    } catch (e) {
      const endedAt = Date.now();
      logLines.push(`✗ Error: ${String(e)}`);
      await analysisRuns.add({
        id: runId, tool: 'bwa', label: r1Path.split(/[\\/]/).pop() ?? r1Path,
        inputs: [refPath, r1Path],
        params: { paired: !!r2Path },
        status: 'error',
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output: null, error: String(e),
        log: [...logLines],
      });
      await notify('BWA-MEM failed', String(e));
    } finally {
      offStderr?.();
      running = false;
      startedAt = null;
      selectedRunId = runId;
    }
  }

  async function deleteRun(id: string, label: string) {
    const ok = await confirm({ title: 'Delete run', message: `Delete run for "${label}"?`, confirmLabel: 'Delete' });
    if (!ok) return;
    if (selectedRunId === id) selectedRunId = bwaRuns.find(r => r.id !== id)?.id ?? null;
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
      <span class="text-xs font-medium text-zinc-600">Run history</span>
      {#if bwaRuns.length > 0}
        <span class="text-[10px] text-zinc-400">{bwaRuns.length}</span>
      {/if}
    </div>
    <div class="flex-1 overflow-y-auto py-1">
      {#if bwaRuns.length === 0}
        <p class="text-xs text-zinc-400 text-center py-8 px-3 leading-relaxed">No runs yet.<br/>Results will appear here.</p>
      {:else}
        {#each bwaRuns as run (run.id)}
          <div class="group relative flex items-start transition-colors {selectedRunId === run.id ? 'bg-brand/8' : 'hover:bg-surface-2'}">
            <button onclick={() => selectedRunId = run.id} class="flex-1 text-left px-3 py-2.5 min-w-0">
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="h-1.5 w-1.5 rounded-full shrink-0 {run.status === 'done' ? 'bg-emerald-500' : 'bg-red-500'}"></span>
                <p class="text-xs font-medium truncate {selectedRunId === run.id ? 'text-brand' : 'text-zinc-700'}">{run.label}</p>
              </div>
              <p class="text-[10px] text-zinc-400 pl-3">{fmtDate(run.startedAt)} · {fmtDuration(run.startedAt, run.endedAt)}</p>
            </button>
            <button onclick={() => deleteRun(run.id, run.label)} aria-label="Delete run"
              class="opacity-0 group-hover:opacity-100 p-1.5 mt-2 mr-1.5 shrink-0 text-zinc-400 hover:text-red-500 transition-all rounded">
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
    <PageHeader title="BWA-MEM" description="Map short reads to a reference genome">
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

      <DepCheck req={DEP_REQUIREMENTS.bwa} onStatusChange={(s) => depStatus = s} />

      {#if depStatus === 'ok'}
        <Card class="p-5 space-y-4">
          <h2 class="text-sm font-semibold text-zinc-800">bwa mem</h2>

          <FilePickerPopup
            files={fastaFiles}
            value={refPath}
            label="Reference FASTA"
            emptyText="No FASTA files in Data yet."
            disabled={running}
            onchange={(p) => refPath = p}
          />

          <FilePickerPopup
            files={fastqFiles}
            value={r1Path}
            label="Reads R1 (FASTQ)"
            emptyText="No FASTQ files in Data yet."
            disabled={running}
            onchange={(p) => r1Path = p}
          />

          <FilePickerPopup
            files={fastqFiles}
            value={r2Path}
            label="Reads R2 (optional, paired-end)"
            emptyText="No FASTQ files in Data yet."
            disabled={running}
            onchange={(p) => r2Path = p}
          />

          <div class="flex items-center gap-3 pt-1">
            <Button
              variant="primary"
              disabled={!refPath || !r1Path || running}
              loading={running}
              onclick={runBwa}
            >
              Run alignment
            </Button>
            {#if running && startedAt}
              <span class="text-xs text-zinc-400">Elapsed: {fmtDuration(startedAt, now)}</span>
            {/if}
          </div>

          <TerminalOutput lines={logLines} {running} />
        </Card>

        {#if displayError}
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono" data-selectable>{displayError}</div>
        {:else if loadingOutput}
          <div class="flex justify-center py-12">
            <svg class="animate-spin h-5 w-5 text-zinc-400" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          </div>
        {:else if loadedOutput}
          <div>
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-xs font-medium text-zinc-400 uppercase tracking-wider">{selectedRun?.label ?? 'Results'}</h2>
              {#if selectedRun}
                <span class="text-xs text-zinc-400">{fmtDate(selectedRun.startedAt)} · {fmtDuration(selectedRun.startedAt, selectedRun.endedAt)}</span>
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
