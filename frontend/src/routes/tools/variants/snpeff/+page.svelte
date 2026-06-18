<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import { liatir } from '$lib/api';
  import { fmtDuration } from '$lib/utils';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { runNativeTool } from '$lib/utils/native-tool';
  import { snpEffStore } from '$lib/stores/snpeff.svelte';
  import DepCheck, { type DepStatus } from '$lib/components/ui/DepCheck.svelte';
  import { DEP_REQUIREMENTS } from '$lib/data/dep-requirements';
  import {
    SNPEFF_GENOMES,
    SNPEFF_DOWNLOAD_URL,
    buildSnpEffOutput,
    parseSnpEffStats,
  } from '$lib/tools/variants/snpeff';

  import type { ToolOutput } from '$lib/types/tool-output';
  import type { RunOutputFile } from '$lib/stores/analysisRuns.svelte';

  // ── dep / config state ────────────────────────────────────────────
  let depStatus = $state<DepStatus>('checking');

  // ── genome state ──────────────────────────────────────────────────
  let selectedGenome = $state('hg38');
  let customGenome   = $state('');
  let genomePresent  = $state<boolean | null>(null);
  let genomeChecking = $state(false);
  let dbDownloading  = $state(false);
  let dbDownloadId   = $state<string | null>(null);

  const effectiveGenome = $derived(customGenome.trim() || selectedGenome);

  // ── form state ────────────────────────────────────────────────────
  let filePath  = $state('');
  let running   = $state(false);
  let startedAt = $state<number | null>(null);

  // ── history ───────────────────────────────────────────────────────
  let selectedRunId = $state<string | null>(null);
  let loadedOutput  = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);

  const snpeffRuns  = $derived(analysisRuns.byTool('snpeff'));
  const vcfFiles    = $derived(dataFiles.byExt('vcf', 'vcf.gz'));
  const selectedRun = $derived(snpeffRuns.find(r => r.id === selectedRunId) ?? null);
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

  // Check genome presence when genome selection changes
  $effect(() => {
    const genome = effectiveGenome;
    if (!snpEffStore.config.jarPath) { genomePresent = null; return; }
    genomeChecking = true;
    genomePresent = null;
    snpEffStore.checkGenomePresent(genome).then(present => {
      genomePresent = present;
      genomeChecking = false;
    });
  });

  onMount(async () => {
    dataFiles.init();
    analysisRuns.init().then(() => {
      if (snpeffRuns.length > 0 && selectedRunId === null) {
        selectedRunId = snpeffRuns[0].id;
      }
    });
    await snpEffStore.init();
  });

  // ── JAR: browse existing ──────────────────────────────────────────
  async function browseJar() {
    const api = liatir();
    if (!api) return;
    try {
      const result = await api.invoke('lia_file_open', { multi: false, allowedExtensions: ['jar'] } as any) as { paths: string[] };
      const path = result.paths[0] ?? null;
      if (path) await snpEffStore.setJarPath(path);
    } catch { /* cancelled */ }
  }

  async function openSnpEffDownloadPage() {
    const api = liatir();
    if (!api) return;
    await api.openBrowser(SNPEFF_DOWNLOAD_URL);
  }

  // ── Database: download ────────────────────────────────────────────
  async function downloadDatabase() {
    if (!snpEffStore.config.jarPath) return;
    const api = liatir();
    if (!api) return;

    dbDownloading = true;
    const genome = effectiveGenome;
    const id = `snpeff-db-${genome}-${Date.now()}`;
    dbDownloadId = id;

    try {
      // Run: java -jar snpEff.jar download -dataDir <dir> <genome>
      // This spawns a long-running process (can be several GB)
      const result = await runNativeTool('java', [
        '-jar', snpEffStore.config.jarPath,
        'download',
        '-dataDir', snpEffStore.config.dataDir,
        genome,
      ]);

      if (!result.ok) {
        throw new Error(result.stderr || `SnpEff download exited with code ${result.exitCode}`);
      }

      await snpEffStore.markGenomeDownloaded(genome);
      genomePresent = true;
    } catch (e) {
      alert(`Database download failed: ${e}`);
    } finally {
      dbDownloading = false;
      dbDownloadId = null;
    }
  }

  // ── Annotation run ────────────────────────────────────────────────
  async function runAnnotation() {
    if (!filePath || !snpEffStore.config.jarPath) return;

    running   = true;
    selectedRunId = null;
    startedAt = Date.now();

    const runId    = crypto.randomUUID();
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const t0       = startedAt;
    const fileSize = dataFiles.files.find(f => f.path === filePath)?.size;
    const inputSizes = fileSize != null ? [fileSize] : undefined;
    const genome   = effectiveGenome;
    const api = liatir();
    if (!api) { running = false; return; }

    try {
      const { data: dataDir } = await api.invoke('lia_fs_paths') as { data: string; cache: string };
      const outDir  = `${dataDir}/tool-outputs`;
      const outPath = `${outDir}/snpeff-${runId}.vcf`;

      const result = await runNativeTool('java', [
        '-Xmx4g',
        '-jar', snpEffStore.config.jarPath,
        'ann',
        '-dataDir', snpEffStore.config.dataDir,
        '-noStats',
        '-noLog',
        genome,
        filePath,
      ]);

      if (!result.ok && result.stdout.trim() === '') {
        throw new Error(result.stderr || `SnpEff exited with code ${result.exitCode}`);
      }

      // Write stdout (annotated VCF) to file
      await api.invoke('lia_write_file_path', { path: outPath, content: result.stdout });
      const outFileSize = await api.invoke('lia_file_size', { path: outPath }) as number;

      const outputFiles: RunOutputFile[] = [{
        label: 'Annotated VCF',
        path: outPath,
        ext: 'vcf',
        size: outFileSize,
      }];

      const summary = parseSnpEffStats(result.stderr); // SnpEff writes stats to stderr
      const output  = buildSnpEffOutput(summary, fileName, result.stderr);
      const endedAt = Date.now();

      await analysisRuns.add({
        id: runId, tool: 'snpeff', label: fileName,
        inputs: [filePath], inputSizes,
        params: { genome },
        status: 'done',
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output, outputFiles, error: null,
      });
    } catch (e) {
      const endedAt = Date.now();
      await analysisRuns.add({
        id: runId, tool: 'snpeff', label: fileName,
        inputs: [filePath], inputSizes,
        params: { genome },
        status: 'error',
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output: null, error: String(e),
      });
    } finally {
      running   = false;
      startedAt = null;
      selectedRunId = runId;
    }
  }

  async function deleteRun(id: string, label: string) {
    const ok = await confirm({ title: 'Delete run', message: `Delete run for "${label}"?`, confirmLabel: 'Delete' });
    if (!ok) return;
    if (selectedRunId === id) selectedRunId = snpeffRuns.find(r => r.id !== id)?.id ?? null;
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
      {#if snpeffRuns.length > 0}
        <span class="text-[10px] text-zinc-400">{snpeffRuns.length}</span>
      {/if}
    </div>
    <div class="flex-1 overflow-y-auto py-1">
      {#if snpeffRuns.length === 0}
        <p class="text-xs text-zinc-400 text-center py-8 px-3 leading-relaxed">No runs yet.<br/>Results will appear here.</p>
      {:else}
        {#each snpeffRuns as run (run.id)}
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
    <PageHeader title="SnpEff" description="Variant annotation with functional effect prediction">
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

      <!-- Step 1: Java check -->
      <DepCheck req={DEP_REQUIREMENTS.java} onStatusChange={(s) => depStatus = s} />

      {#if depStatus === 'ok'}

        <!-- Step 2: JAR configuration -->
        <Card class="p-5 space-y-4">
          <h2 class="text-sm font-semibold text-zinc-800">1 — SnpEff JAR</h2>

          {#if snpEffStore.config.jarPath}
            <div class="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-medium text-zinc-800 truncate">{snpEffStore.config.jarPath}</p>
              </div>
              <button onclick={() => snpEffStore.setJarPath(null)} class="text-[10px] text-zinc-400 hover:text-zinc-600">Change</button>
            </div>
          {:else}
            <p class="text-xs text-zinc-500">
              Select your <code class="font-mono">snpEff.jar</code>. If you don't have it yet, download SnpEff from the official website and point Liatir to the JAR.
            </p>

            <div class="flex gap-2">
              <Button variant="primary" onclick={browseJar}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                Select snpEff.jar
              </Button>
              <Button variant="secondary" onclick={openSnpEffDownloadPage}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Download SnpEff
              </Button>
            </div>

            <p class="text-[11px] text-zinc-400">
              Download the ZIP from the SnpEff website, extract it, then select <code class="font-mono">snpEff.jar</code> from the extracted folder.
            </p>
          {/if}
        </Card>

        <!-- Step 3: Database (only if JAR is configured) -->
        {#if snpEffStore.config.jarPath}
          <Card class="p-5 space-y-4">
            <h2 class="text-sm font-semibold text-zinc-800">2 — Genome database</h2>

            <!-- Genome selector -->
            <div class="space-y-2">
              <label class="text-xs font-medium text-zinc-600">Genome</label>
              <div class="flex gap-2">
                <select
                  bind:value={selectedGenome}
                  class="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-brand/30"
                >
                  {#each SNPEFF_GENOMES as g}
                    <option value={g.id}>{g.label}</option>
                  {/each}
                </select>
              </div>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  bind:value={customGenome}
                  placeholder="Or type a custom genome ID…"
                  class="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono
                         placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
                {#if customGenome.trim()}
                  <button onclick={() => customGenome = ''} class="text-xs text-zinc-400 hover:text-zinc-600">Clear</button>
                {/if}
              </div>
              <p class="text-[11px] text-zinc-400">
                Active: <code class="font-mono text-zinc-600">{effectiveGenome}</code>
              </p>
            </div>

            <!-- Database status -->
            {#if genomeChecking}
              <div class="flex items-center gap-2 text-xs text-zinc-500">
                <svg class="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Checking database…
              </div>
            {:else if genomePresent === true}
              <div class="flex items-center gap-2 text-xs text-emerald-600">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Database ready — {effectiveGenome}
              </div>
            {:else if genomePresent === false}
              <div class="space-y-3">
                <div class="flex items-center gap-2 text-xs text-amber-600">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  Database not found — download required (1–3 GB depending on genome)
                </div>
                <Button
                  variant="secondary"
                  disabled={dbDownloading}
                  loading={dbDownloading}
                  onclick={downloadDatabase}
                >
                  Download {effectiveGenome} database
                </Button>
                {#if dbDownloading}
                  <p class="text-xs text-zinc-400">This may take several minutes depending on your connection. The download runs via Java and cannot be paused.</p>
                {/if}
              </div>
            {/if}
          </Card>

          <!-- Step 4: Annotation (only if database ready) -->
          {#if genomePresent}
            <Card class="p-5 space-y-4">
              <h2 class="text-sm font-semibold text-zinc-800">3 — Annotate variants</h2>

              <FilePickerPopup
                files={vcfFiles}
                value={filePath}
                label="VCF file"
                emptyText="No VCF files in Data yet."
                onchange={(p) => filePath = p}
              />

              <div class="flex items-center gap-3 pt-1">
                <Button
                  variant="primary"
                  disabled={!filePath || running}
                  loading={running}
                  onclick={runAnnotation}
                >
                  Run annotation
                </Button>
                {#if running && startedAt}
                  <span class="text-xs text-zinc-400">Elapsed: {fmtDuration(startedAt)}</span>
                {/if}
              </div>
            </Card>
          {/if}
        {/if}

        <!-- Results -->
        {#if displayError}
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono">{displayError}</div>
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
