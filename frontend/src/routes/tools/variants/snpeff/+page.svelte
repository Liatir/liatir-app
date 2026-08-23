<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import TerminalOutput from '$lib/components/ui/TerminalOutput.svelte';
  import { notify } from '$lib/utils/notify';
  import RunLog from '$lib/components/ui/RunLog.svelte';
  import { liatir } from '$lib/api';
  import { fmtDuration, getLastSegmentsStringFromPath, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { beginDirectNativeToolRun } from '$lib/execution/direct-native-tool';
  import { runNativeTool } from '$lib/utils/native-tool';
  import { ensureRunOutputDir } from '$lib/execution/run-storage';
  import { snpEffStore } from '$lib/stores/snpeff.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
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
  let selectedGenome = $state('GRCh38.115');
  let customGenome   = $state('');
  let genomeSearch   = $state('');
  let genomePresent  = $state<boolean | null>(null);
  let genomeChecking = $state(false);
  let dbDownloading  = $state(false);
  let dbDownloadId   = $state<string | null>(null);

  const effectiveGenome = $derived(customGenome.trim() || selectedGenome);

  const sortedGenomes = $derived(
    SNPEFF_GENOMES
      .filter(g => {
        const q = genomeSearch.toLowerCase().trim();
        return !q || g.id.toLowerCase().includes(q) || g.label.toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => {
        const ad = snpEffStore.config.downloadedGenomes.includes(a.id);
        const bd = snpEffStore.config.downloadedGenomes.includes(b.id);
        if (ad !== bd) return ad ? -1 : 1;
        if (ad && bd) return (snpEffStore.lastUsed[b.id] ?? 0) - (snpEffStore.lastUsed[a.id] ?? 0);
        return 0;
      })
  );

  // ── form state ────────────────────────────────────────────────────
  let filePath         = $state('');
  let running          = $state(false);
  let startedAt        = $state<number | null>(null);
  let logLines         = $state<string[]>([]);
  let now              = $state(Date.now());
  let activeExecutionRunId = $state<string | null>(null);

  $effect(() => {
    if (!running) return;
    const id = setInterval(() => now = Date.now(), 1000);
    return () => clearInterval(id);
  });

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

  // Check genome presence when genome selection changes.
  // For known genomes, use the store list instantly; for custom IDs, hit the filesystem.
  $effect(() => {
    const genome = effectiveGenome;
    if (!snpEffStore.config.jarPath) { genomePresent = null; return; }
    if (snpEffStore.config.downloadedGenomes.includes(genome)) {
      genomePresent = true;
      genomeChecking = false;
      return;
    }
    genomeChecking = true;
    genomePresent = null;
    snpEffStore.checkGenomePresent(genome).then(present => {
      genomePresent = present;
      genomeChecking = false;
    });
  });

  onMount(async () => {
    dataFiles.init();
    analysisRuns.init();
    await snpEffStore.init();
    await settingsStore.init();
    await reattachIfDownloading();
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
  let dbBytesDownloaded  = $state(0);
  let dbBytesTotal       = $state<number | null>(null);
  let dbExtracting       = $state(false);
  let dbError            = $state<string | null>(null);
  let dbDownloadingGenome = $state<string | null>(null);

  // Tauri 2 event names don't allow dots — sanitize genome name for use in event IDs
  function genomeToId(genome: string) {
    return `snpeff-db-${genome.replace(/\./g, '-')}`;
  }

  function handleProgressEvent(p: { bytesDownloaded?: number; bytesTotal?: number; done: boolean; extracting?: boolean; error?: string }) {
    if (p.extracting) {
      dbExtracting = true;
    } else if (!p.done) {
      dbBytesDownloaded = p.bytesDownloaded ?? 0;
      dbBytesTotal = p.bytesTotal ?? null;
    }
  }

  async function cancelDownload() {
    const api = liatir();
    if (!api || !dbDownloadId) return;
    await api.invoke('lia_managed_download_cancel', { id: dbDownloadId } as any);
  }

  async function deleteDatabase(genome: string) {
    const ok = await confirm({
      title: 'Delete database',
      message: `Delete the "${genome}" genome database? You'll need to re-download it to use it again.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const api = liatir();
    if (!api) return;
    const path = `${snpEffStore.config.dataDir}/${genome}`;
    try { await api.invoke('lia_fs_rm', { path } as any); } catch { /* already gone */ }
    snpEffStore.removeGenome(genome);
    if (genome === effectiveGenome) genomePresent = false;
  }

  async function startDownloadFor(genome: string) {
    selectedGenome = genome;
    customGenome = '';
    // $effect will update effectiveGenome synchronously; call after next tick
    await Promise.resolve();
    await downloadDatabase();
  }

  async function downloadDatabase() {
    if (!snpEffStore.config.jarPath) return;
    if (dbDownloading) return;
    const api = liatir();
    if (!api) return;

    const genome = effectiveGenome;
    const id = genomeToId(genome);

    dbDownloading = true;
    dbDownloadingGenome = genome;
    dbBytesDownloaded = 0;
    dbBytesTotal = null;
    dbExtracting = false;
    dbError = null;
    dbDownloadId = id;
    snpEffStore.startDownload(genome);

    const unlisten = await api.desktop.events.on(
      `managed:progress:${id}`,
      (p: any) => handleProgressEvent(p)
    ) as unknown as () => void;

    try {
      await api.invoke('lia_snpeff_download_db', {
        id,
        jarPath: snpEffStore.config.jarPath,
        dataDir: snpEffStore.config.dataDir,
        genome,
      } as any);

      await snpEffStore.markGenomeDownloaded(genome);
      genomePresent = true;
      await notify('SnpEff DB ready', `${genome} database downloaded and ready to use`);
    } catch (e) {
      dbError = String(e);
      await notify('SnpEff DB download failed', String(e));
    } finally {
      unlisten();
      snpEffStore.finishDownload();
      dbDownloading = false;
      dbDownloadingGenome = null;
      dbExtracting = false;
      dbDownloadId = null;
    }
  }

  // Re-attach to an in-progress download when navigating back to this page
  async function reattachIfDownloading() {
    const genome = snpEffStore.activeDownload;
    if (!genome) return;
    const api = liatir();
    if (!api) return;

    selectedGenome = genome;
    customGenome = '';
    dbDownloading = true;
    dbDownloadingGenome = genome;
    dbBytesDownloaded = 0;
    dbBytesTotal = null;
    dbExtracting = false;
    dbError = null;

    const id = genomeToId(genome);
    const unlisten = await api.desktop.events.on(
      `managed:progress:${id}`,
      (p: any) => {
        handleProgressEvent(p as { bytesDownloaded?: number; bytesTotal?: number; done: boolean; extracting?: boolean; error?: string });
        if (p.done) {
          unlisten();
          dbDownloading = false;
          dbDownloadingGenome = null;
          dbExtracting = false;
          snpEffStore.checkGenomePresent(genome).then(present => { genomePresent = present; });
        }
      }
    ) as unknown as () => void;
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
    const params = { genome, heap: snpEffStore.jvmHeap };
    const execution = await beginDirectNativeToolRun({
      runId,
      toolId: 'snpeff',
      label: fileName,
      inputs: [filePath],
      params,
      startedAt: t0,
    }).catch(async (error) => {
      await notify('SnpEff failed', String(error));
      return null;
    });
    if (!execution) {
      running = false;
      startedAt = null;
      return;
    }
    activeExecutionRunId = runId;

    try {
      const outDir = await ensureRunOutputDir(runId);
      const outPath = `${outDir}/annotated.vcf`;

      logLines = [
        `$ java -Xmx${snpEffStore.jvmHeap} -jar snpEff.jar ann ${genome} ${fileName}`,
        `→ Genome: ${genome}  Heap: ${snpEffStore.jvmHeap}`,
        `→ Loading SnpEff database (this may take 1–2 min)…`,
      ];

      const statsBase = outPath.replace(/\.vcf$/, '');
      const statsHtml = `${statsBase}-summary.html`;
      const statsGenes = `${statsBase}-summary.genes.txt`;
      const java = settingsStore.javaPath || 'java';
      const result = await runNativeTool(
        java,
        [
          `-Xmx${snpEffStore.jvmHeap}`,
          '-jar', snpEffStore.config.jarPath,
          'ann',
          '-dataDir', snpEffStore.config.dataDir,
          '-noLog',
          '-stats', statsHtml,
          genome,
          filePath,
        ],
        undefined,
        (line) => { if (line.trim() && logLines.length < 500) logLines.push(line); },
        execution.nativeOptions({ stdoutPath: outPath }),
      );

      if (!result.ok) {
        throw new Error(result.stderr || `SnpEff exited with code ${result.exitCode}`);
      }

      const outFileSize = await api.invoke('lia_file_size', { path: outPath }) as number;

      const outputFiles: RunOutputFile[] = [{
        label: 'Annotated VCF',
        path: outPath,
        ext: 'vcf',
        size: outFileSize,
      }];

      // SnpEff writes a summary alongside the annotation whether or not anyone asked for it. It is
      // not the result — the annotated VCF is — but it is where you look when the annotation counts
      // are surprising, so it is declared rather than left on disk unmentioned. Optional because
      // SnpEff may not get far enough to write it.
      const sideEffects: RunOutputFile[] = [];
      for (const [label, path, ext] of [
        ['Summary (HTML)', statsHtml,  'html'],
        ['Gene stats',     statsGenes, 'txt'],
      ] as const) {
        try {
          const size = await api.invoke('lia_file_size', { path }) as number;
          sideEffects.push({ label, path, ext, size });
        } catch { /* not generated */ }
      }

      const summary = parseSnpEffStats(result.stderr);
      const output  = buildSnpEffOutput(summary, fileName);
      const endedAt = Date.now();
      logLines.push(`✓ Annotation complete in ${fmtDuration(t0, endedAt)}`);

      await snpEffStore.touchGenome(genome);
      await execution.finalize('done', {
        id: runId, tool: 'snpeff', label: fileName,
        inputs: [filePath], inputSizes,
        params,
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output, outputFiles, sideEffects, error: null,
        log: [...logLines],
      });
      await notify('SnpEff complete', `${fileName} finished in ${fmtDuration(t0, endedAt)}`, endedAt - t0);
    } catch (e) {
      const endedAt = Date.now();
      const cancelled = execution.isCancelled(e);
      const message = cancelled ? 'SnpEff run was cancelled.' : String(e);
      logLines.push(cancelled ? `■ ${message}` : `✗ Error: ${message}`);
      await execution.finalize(cancelled ? 'cancelled' : 'error', {
        id: runId, tool: 'snpeff', label: fileName,
        inputs: [filePath], inputSizes,
        // The summary is written last; a run that failed has nothing to point at.
        sideEffects: [],
        params,
        startedAt: t0, endedAt, durationMs: endedAt - t0,
        output: null, error: message,
        log: [...logLines],
      });
      await notify(cancelled ? 'SnpEff cancelled' : 'SnpEff failed', message);
    } finally {
      running       = false;
      startedAt     = null;
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
      <span class="text-xs font-medium text-text-secondary">Run history</span>
      {#if snpeffRuns.length > 0}
        <span class="text-[10px] text-text-subtle">{snpeffRuns.length}</span>
      {/if}
    </div>
    <div class="flex-1 overflow-y-auto py-1">
      {#if snpeffRuns.length === 0}
        <p class="text-xs text-text-subtle text-center py-8 px-3 leading-relaxed">No runs yet.<br/>Results will appear here.</p>
      {:else}
        {#each snpeffRuns as run (run.id)}
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
          <h2 class="text-sm font-semibold text-text">1 — SnpEff JAR</h2>

          {#if snpEffStore.config.jarPath}
            <div class="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-medium text-text truncate" title={getLastSegmentsStringFromPath(snpEffStore.config.jarPath, 2)}>
                  {getLastSegmentsStringFromPath(snpEffStore.config.jarPath, 2)}
                </p>
              </div>
              <button onclick={() => snpEffStore.setJarPath(null)} class="text-[10px] text-text-subtle hover:text-text-secondary">Change</button>
            </div>
          {:else}
            <p class="text-xs text-text-muted">
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

            <p class="text-[11px] text-text-subtle">
              Download the ZIP from the SnpEff website, extract it, then select <code class="font-mono">snpEff.jar</code> from the extracted folder.
            </p>
          {/if}
        </Card>

        <!-- Step 3: Database (only if JAR is configured) -->
        {#if snpEffStore.config.jarPath}
          <Card class="p-5 space-y-3">
            <h2 class="text-sm font-semibold text-text">2 — Genome database</h2>

            <!-- Genome list -->
            <!-- Search -->
            <div class="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
              <svg class="shrink-0 text-text-subtle" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                bind:value={genomeSearch}
                placeholder="Search genomes…"
                class="flex-1 text-xs bg-transparent outline-none text-text-secondary placeholder:text-text-subtle"
              />
              {#if genomeSearch}
                <button onclick={() => genomeSearch = ''} class="text-text-subtle hover:text-text-secondary" aria-label="Clear genome search">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              {/if}
            </div>
            <div class="rounded-lg border border-border overflow-hidden divide-y divide-border max-h-72 overflow-y-auto">
              {#each sortedGenomes as g}
                {@const downloaded = snpEffStore.config.downloadedGenomes.includes(g.id)}
                {@const isDownloading = dbDownloading && dbDownloadingGenome === g.id}
                {@const isSelected = effectiveGenome === g.id && !customGenome.trim()}
                <div
                  role="button" tabindex="0"
                  onclick={() => { if (!dbDownloading) { selectedGenome = g.id; customGenome = ''; } }}
                  onkeydown={(e) => e.key === 'Enter' && !dbDownloading && (selectedGenome = g.id, customGenome = '')}
                  class="flex items-center gap-3 px-3 py-2.5 transition-colors
                    {isSelected ? 'bg-brand/5' : 'hover:bg-surface-2'}
                    {dbDownloading && !isDownloading ? 'cursor-default' : 'cursor-pointer'}"
                >
                  <!-- Status dot -->
                  <div class="h-2 w-2 rounded-full shrink-0
                    {isDownloading ? 'bg-brand animate-pulse' : downloaded ? 'bg-emerald-500' : 'bg-border-2'}">
                  </div>

                  <!-- Label + progress -->
                  <div class="flex-1 min-w-0">
                    <p class="text-xs {isSelected ? 'font-medium text-brand' : 'text-text-secondary'} truncate">{g.label}</p>
                    {#if isDownloading}
                      {#if dbExtracting}
                        <p class="text-[10px] text-text-subtle mt-0.5">Extracting…</p>
                      {:else if dbBytesTotal}
                        {@const pct = Math.round((dbBytesDownloaded / dbBytesTotal) * 100)}
                        <div class="flex items-center gap-2 mt-1">
                          <div class="flex-1 bg-surface-3 rounded-full h-1">
                            <div class="bg-brand h-1 rounded-full transition-all" style="width:{pct}%"></div>
                          </div>
                          <span class="text-[10px] text-text-subtle shrink-0">
                            {pct}% · {(dbBytesDownloaded / 1_048_576).toFixed(0)} / {(dbBytesTotal / 1_048_576).toFixed(0)} MB
                          </span>
                        </div>
                      {:else}
                        <p class="text-[10px] text-text-subtle mt-0.5">Connecting…</p>
                      {/if}
                      {#if dbError}
                        <p class="text-[10px] text-red-600 mt-0.5 font-mono truncate">{sanitizeLocalPathsForDisplay(dbError, 2)}</p>
                      {/if}
                    {/if}
                  </div>

                  <!-- Actions -->
                  <div class="flex items-center gap-1.5 shrink-0" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="none">
                    {#if isDownloading}
                      <button
                        onclick={cancelDownload}
                        class="text-[10px] text-red-500 hover:text-red-700 px-2 py-0.5 rounded border border-red-200 hover:border-red-300 transition-colors"
                      >
                        Cancel
                      </button>
                    {:else if downloaded}
                      <button
                        onclick={() => deleteDatabase(g.id)}
                        class="text-[10px] text-text-subtle hover:text-red-500 px-2 py-0.5 rounded border border-transparent hover:border-red-200 transition-colors"
                      >
                        Delete
                      </button>
                    {:else}
                      <button
                        disabled={dbDownloading}
                        onclick={() => startDownloadFor(g.id)}
                        class="text-[10px] text-brand hover:text-brand/80 disabled:opacity-30 disabled:cursor-not-allowed px-2 py-0.5 rounded border border-brand/30 hover:border-brand/60 transition-colors"
                      >
                        Download
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>

            <!-- Custom genome input -->
            <div class="space-y-1.5">
              <p class="text-[11px] text-text-muted">Custom genome ID (overrides selection above):</p>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  bind:value={customGenome}
                  disabled={dbDownloading}
                  placeholder="e.g. GRCh38.mane.1.5.refseq"
                  class="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-mono
                         placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-brand/30
                         disabled:opacity-50"
                />
                {#if customGenome.trim()}
                  <button onclick={() => customGenome = ''} class="text-xs text-text-subtle hover:text-text-secondary">Clear</button>
                {/if}
              </div>
              {#if customGenome.trim()}
                <p class="text-[10px] text-text-subtle">
                  Active: <code class="font-mono text-text-secondary">{effectiveGenome}</code>
                  {#if genomeChecking}
                    <span class="ml-1 text-text-subtle">· checking…</span>
                  {:else if genomePresent === true}
                    <span class="ml-1 text-emerald-600">· ready</span>
                  {:else if genomePresent === false}
                    <span class="ml-1 text-amber-600">· not downloaded</span>
                  {/if}
                </p>
              {/if}
            </div>
          </Card>

          <!-- Step 4: Annotation (only if database ready) -->
          {#if genomePresent}
            <Card class="p-5 space-y-4">
              <h2 class="text-sm font-semibold text-text">3 — Annotate variants</h2>

              <!-- Resource warning -->
              <div class="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <svg class="shrink-0 mt-0.5" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <p class="text-[11px] text-amber-800 leading-relaxed">
                  SnpEff is computationally intensive. Large genomes (human, mouse, zebrafish…) require <strong>8+ GB RAM</strong> and can take 5–15 minutes to annotate. Smaller genomes need less memory and are faster.
                </p>
              </div>

              <!-- JVM heap -->
              <div class="flex items-center gap-3">
                <span class="text-[11px] text-text-muted shrink-0">Java heap (RAM)</span>
                <div class="flex gap-1.5">
                  {#each ['4g', '6g', '8g', '12g', '16g'] as heap}
                    <button
                      onclick={() => snpEffStore.setJvmHeap(heap)}
                      class="px-2.5 py-1 rounded-md border text-xs transition-colors
                        {snpEffStore.jvmHeap === heap
                          ? 'bg-brand text-white border-brand'
                          : 'bg-surface border-border text-text-secondary hover:border-brand/40'}"
                    >
                      {heap.replace('g', ' GB')}
                    </button>
                  {/each}
                </div>
                {#if parseInt(snpEffStore.jvmHeap) < 8}
                  <span class="text-[10px] text-amber-600">↑ large genomes need 8+ GB</span>
                {/if}
              </div>

              <FilePickerPopup
                files={vcfFiles}
                value={filePath}
                label="VCF file"
                emptyText="No VCF files in Data yet."
                disabled={running}
                onchange={(p) => filePath = p}
              />

              <div class="flex items-center gap-3 pt-1">
                <Button
                  variant="primary"
                  testId="direct-native-run"
                  disabled={!filePath || running}
                  loading={running}
                  onclick={runAnnotation}
                >
                  Run annotation
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
          {/if}
        {/if}

        <!-- Results -->
        {#if displayError}
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono">{sanitizeLocalPathsForDisplay(displayError, 2)}</div>
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
            <ToolResultView output={loadedOutput} outputFiles={selectedRunOutputFiles} runId={selectedRunId} />
            <RunLog runId={selectedRunId} />
          </div>
        {/if}
      {/if}

    </div>
  </div>
</div>
