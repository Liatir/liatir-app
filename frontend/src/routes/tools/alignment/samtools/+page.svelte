<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import { offlab } from '$lib/api';
  import { fmtDuration } from '$lib/utils';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns, type AnalysisRun } from '$lib/stores/analysisRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { runNativeTool } from '$lib/utils/native-tool';
  import { parseFlagstatResult, flagstatToToolOutput } from '$lib/tools/alignment/samtools';
  import type { ToolOutput } from '$lib/types/tool-output';

  // ── dep check ────────────────────────────────────────────────────
  let depChecked = $state(false);
  let depAvailable = $state(false);
  let depVersion = $state<string | null>(null);

  // ── form state ───────────────────────────────────────────────────
  let filePath = $state('');
  let running = $state(false);
  let startedAt = $state<number | null>(null);

  // ── history ──────────────────────────────────────────────────────
  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);

  const samtoolsRuns = $derived(analysisRuns.byTool('samtools'));
  const bamFiles = $derived(dataFiles.byExt('bam', 'sam', 'cram'));
  const selectedRun = $derived(samtoolsRuns.find(r => r.id === selectedRunId) ?? null);
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

  onMount(async () => {
    dataFiles.init();
    analysisRuns.init().then(() => {
      if (samtoolsRuns.length > 0 && selectedRunId === null) {
        selectedRunId = samtoolsRuns[0].id;
      }
    });

    const api = offlab();
    if (api) {
      const result = await api.deps.check('samtools');
      depAvailable = result.available;
      depVersion = result.version;
    }
    depChecked = true;
  });

  // ── run ──────────────────────────────────────────────────────────
  async function runFlagstat() {
    if (!filePath) return;

    running = true;
    selectedRunId = null;
    startedAt = Date.now();

    const runId = crypto.randomUUID();
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const t0 = startedAt;

    try {
      const result = await runNativeTool('samtools', ['flagstat', filePath]);

      if (!result.ok && result.stdout.trim() === '') {
        throw new Error(result.stderr || `samtools exited with code ${result.exitCode}`);
      }

      const parsed = parseFlagstatResult(result.stdout);
      const output = flagstatToToolOutput(parsed, result.stdout);
      const endedAt = Date.now();

      await analysisRuns.add({
        id: runId, tool: 'samtools', label: fileName,
        inputs: [filePath],
        params: { subcommand: 'flagstat' },
        status: 'done',
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output, error: null,
      });
    } catch (e) {
      const endedAt = Date.now();
      await analysisRuns.add({
        id: runId, tool: 'samtools', label: fileName,
        inputs: [filePath],
        params: { subcommand: 'flagstat' },
        status: 'error',
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output: null, error: String(e),
      });
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
      selectedRunId = samtoolsRuns.find(r => r.id !== id)?.id ?? null;
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
      {#if samtoolsRuns.length > 0}
        <span class="text-[10px] text-zinc-400">{samtoolsRuns.length}</span>
      {/if}
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if samtoolsRuns.length === 0}
        <p class="text-xs text-zinc-400 text-center py-8 px-3 leading-relaxed">
          No runs yet.<br />Results will appear here.
        </p>
      {:else}
        {#each samtoolsRuns as run (run.id)}
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
      title="Samtools"
      description="Alignment statistics for BAM/SAM/CRAM files"
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

      <!-- Dep check gate -->
      {#if !depChecked}
        <Card class="p-5 flex items-center gap-3">
          <svg class="animate-spin h-4 w-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          <span class="text-sm text-zinc-500">Checking for samtools…</span>
        </Card>

      {:else if !depAvailable}
        <Card class="p-5 space-y-4">
          <div class="flex items-start gap-3">
            <div class="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div>
              <p class="text-sm font-semibold text-zinc-800">samtools not found</p>
              <p class="text-xs text-zinc-500 mt-0.5 leading-relaxed">
                samtools was not detected in your PATH. Install it to use this tool.
              </p>
            </div>
          </div>

          <div class="rounded-lg border border-border bg-surface-2 p-3 space-y-2">
            <p class="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Install options</p>
            <div class="space-y-1.5 font-mono text-xs text-zinc-700">
              <div class="flex items-center gap-2">
                <span class="text-zinc-400 w-14 shrink-0">macOS</span>
                <code class="bg-zinc-100 px-2 py-0.5 rounded">brew install samtools</code>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-zinc-400 w-14 shrink-0">Ubuntu</span>
                <code class="bg-zinc-100 px-2 py-0.5 rounded">sudo apt install samtools</code>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-zinc-400 w-14 shrink-0">conda</span>
                <code class="bg-zinc-100 px-2 py-0.5 rounded">conda install -c bioconda samtools</code>
              </div>
            </div>
          </div>

          <p class="text-xs text-zinc-400">After installing, restart Offlab or reload this page.</p>
        </Card>

      {:else}
        <!-- Tool available -->
        <Card class="p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-zinc-800">flagstat</h2>
            {#if depVersion}
              <span class="text-[10px] text-zinc-400 font-mono">{depVersion}</span>
            {/if}
          </div>

          <!-- File selector -->
          <div>
            <p class="text-xs text-zinc-500 mb-1.5">Select a BAM / SAM / CRAM file</p>
            {#if bamFiles.length === 0}
              <div class="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-3 text-sm text-zinc-400 flex items-center justify-between">
                No BAM/SAM/CRAM files in Data yet.
                <a href="/data" class="text-brand text-xs font-medium hover:underline">Go to Data →</a>
              </div>
            {:else}
              <div class="space-y-1.5">
                {#each bamFiles as file (file.id)}
                  <button
                    onclick={() => filePath = file.path}
                    class="w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors
                      {filePath === file.path
                        ? 'border-brand bg-brand/5'
                        : 'border-border bg-surface-2 hover:border-border-2'}"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                      stroke={filePath === file.path ? '#4f39f6' : '#a1a1aa'}
                      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                      <polyline points="13 2 13 9 20 9" />
                    </svg>
                    <span class="flex-1 min-w-0">
                      <span class="block text-sm font-medium truncate {filePath === file.path ? 'text-brand' : 'text-zinc-800'}">{file.name}</span>
                      <span class="block text-[11px] text-zinc-400 truncate">{file.path}</span>
                    </span>
                    <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-sky-100 text-sky-700 border border-sky-200">
                      {file.ext}
                    </span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <div class="flex items-center gap-3 pt-1">
            <Button
              variant="primary"
              disabled={!filePath || running}
              loading={running}
              onclick={runFlagstat}
            >
              Run flagstat
            </Button>
            {#if running && startedAt}
              <span class="text-xs text-zinc-400">
                Elapsed: {fmtDuration(startedAt)}
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
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                {selectedRun?.label ?? 'Results'}
              </h2>
              {#if selectedRun}
                <span class="text-xs text-zinc-400">
                  {fmtDate(selectedRun.startedAt)} · {fmtDuration(selectedRun.startedAt, selectedRun.endedAt)}
                </span>
              {/if}
            </div>
            <ToolResultView output={loadedOutput} />
          </div>
        {/if}
      {/if}

    </div>
  </div>
</div>
