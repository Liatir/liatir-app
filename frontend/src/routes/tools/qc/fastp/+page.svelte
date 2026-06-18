<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import { liatir } from '$lib/api';
  import { fmtDuration } from '$lib/utils';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { runNativeTool } from '$lib/utils/native-tool';
  import { parseFastpJson, fastpToToolOutput } from '$lib/tools/qc/fastp';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import type { ToolOutput } from '$lib/types/tool-output';
  import type { RunOutputFile } from '$lib/types/pipeline';

  // ── dep check ────────────────────────────────────────────────────
  let depChecked = $state(false);
  let depAvailable = $state(false);
  let depVersion = $state<string | null>(null);

  // ── form state ───────────────────────────────────────────────────
  let r1Path = $state('');
  let r2Path = $state('');
  let running = $state(false);
  let startedAt = $state<number | null>(null);

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

  onMount(async () => {
    dataFiles.init();
    analysisRuns.init().then(() => {
      if (fastpRuns.length > 0 && selectedRunId === null) {
        selectedRunId = fastpRuns[0].id;
      }
    });

    const api = liatir();
    if (api) {
      const result = await api.deps.check('fastp');
      depAvailable = result.available;
      depVersion = result.version;
    }
    depChecked = true;
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

    const r1Size = dataFiles.files.find(f => f.path === r1Path)?.size;
    const r2Size = isPaired ? dataFiles.files.find(f => f.path === r2Path)?.size : undefined;
    const inputSizes = [r1Size, r2Size].filter((s): s is number => s != null);

    const api = liatir();

    try {
      const paths = await api!.invoke('dtr_fs_paths', {}) as { data: string; cache: string };
      const base = `${paths.data}/tool-outputs`;
      const jsonPath = `${base}/fastp-${runId}.json`;
      const out1Path = `${base}/fastp-${runId}-R1.fastq.gz`;
      const out2Path = `${base}/fastp-${runId}-R2.fastq.gz`;

      const args = [
        '--in1', r1Path,
        '--out1', out1Path,
        '--json', jsonPath,
        '--html', '/dev/null',
      ];
      if (isPaired) {
        args.push('--in2', r2Path, '--out2', out2Path);
      }

      const result = await runNativeTool('fastp', args);

      if (!result.ok) {
        throw new Error(result.stderr || `fastp exited with code ${result.exitCode}`);
      }

      const jsonText = await api!.invoke('dtr_read_file_text', { path: jsonPath }) as string;
      const parsed = parseFastpJson(jsonText);
      const output = fastpToToolOutput(parsed);
      const endedAt = Date.now();

      // Collect output files
      const outputFiles: RunOutputFile[] = [];
      const trySize = async (p: string) => { try { return await api!.invoke('dtr_file_size', { path: p }) as number; } catch { return undefined; } };
      outputFiles.push({ label: 'Trimmed R1', path: out1Path, ext: 'fastq.gz', size: await trySize(out1Path) });
      if (isPaired) {
        outputFiles.push({ label: 'Trimmed R2', path: out2Path, ext: 'fastq.gz', size: await trySize(out2Path) });
      }

      await analysisRuns.add({
        id: runId, tool: 'fastp', label,
        inputs: isPaired ? [r1Path, r2Path] : [r1Path],
        inputSizes: inputSizes.length > 0 ? inputSizes : undefined,
        params: { paired: isPaired },
        outputFiles,
        status: 'done',
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output, error: null,
      });
    } catch (e) {
      const endedAt = Date.now();
      await analysisRuns.add({
        id: runId, tool: 'fastp', label,
        inputs: isPaired ? [r1Path, r2Path] : [r1Path],
        inputSizes: inputSizes.length > 0 ? inputSizes : undefined,
        params: { paired: isPaired },
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
      <span class="text-xs font-medium text-zinc-600">Run history</span>
      {#if fastpRuns.length > 0}
        <span class="text-[10px] text-zinc-400">{fastpRuns.length}</span>
      {/if}
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if fastpRuns.length === 0}
        <p class="text-xs text-zinc-400 text-center py-8 px-3 leading-relaxed">
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

      <!-- Dep check gate -->
      {#if !depChecked}
        <Card class="p-5 flex items-center gap-3">
          <svg class="animate-spin h-4 w-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          <span class="text-sm text-zinc-500">Checking for fastp…</span>
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
              <p class="text-sm font-semibold text-zinc-800">fastp not found</p>
              <p class="text-xs text-zinc-500 mt-0.5 leading-relaxed">
                fastp was not detected in your PATH. Install it to use this tool.
              </p>
            </div>
          </div>

          <div class="rounded-lg border border-border bg-surface-2 p-3 space-y-2">
            <p class="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Install options</p>
            <div class="space-y-1.5 font-mono text-xs text-zinc-700">
              <div class="flex items-center gap-2">
                <span class="text-zinc-400 w-14 shrink-0">macOS</span>
                <code class="bg-zinc-100 px-2 py-0.5 rounded">brew install fastp</code>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-zinc-400 w-14 shrink-0">Ubuntu</span>
                <code class="bg-zinc-100 px-2 py-0.5 rounded">sudo apt install fastp</code>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-zinc-400 w-14 shrink-0">conda</span>
                <code class="bg-zinc-100 px-2 py-0.5 rounded">conda install -c bioconda fastp</code>
              </div>
            </div>
          </div>

          <p class="text-xs text-zinc-400">After installing, restart Liatir or reload this page.</p>
        </Card>

      {:else}
        <!-- Tool available -->
        <Card class="p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-zinc-800">trim &amp; filter</h2>
            {#if depVersion}
              <span class="text-[10px] text-zinc-400 font-mono">{depVersion}</span>
            {/if}
          </div>

          <!-- R1 file selector -->
          <FilePickerPopup
            files={fastqFiles}
            value={r1Path}
            label="R1 — FASTQ file (required)"
            placeholder="Select R1 file…"
            emptyText="No FASTQ files in Data yet."
            onchange={(p) => r1Path = p}
          />

          <!-- R2 file selector (optional) -->
          <div>
            <FilePickerPopup
              files={fastqFiles}
              value={r2Path}
              label="R2 — FASTQ file (optional, for paired-end)"
              placeholder="Select R2 file… (leave empty for single-end)"
              emptyText="No FASTQ files in Data yet."
              onchange={(p) => r2Path = p}
            />
            {#if isPaired}
              <p class="text-[11px] text-emerald-600 mt-1.5">Paired-end mode</p>
            {:else}
              <p class="text-[11px] text-zinc-400 mt-1.5">Single-end mode — add R2 for paired-end</p>
            {/if}
          </div>

          <div class="flex items-center gap-3 pt-1">
            <Button
              variant="primary"
              disabled={!r1Path || running}
              loading={running}
              onclick={runFastp}
            >
              Run fastp
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
            <ToolResultView output={loadedOutput} outputFiles={selectedRunOutputFiles} />
          </div>
        {/if}
      {/if}

    </div>
  </div>
</div>
