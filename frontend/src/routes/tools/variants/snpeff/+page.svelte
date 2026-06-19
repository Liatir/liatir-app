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
  let annotationStatus = $state<string | null>(null);
  let now              = $state(Date.now());

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
    analysisRuns.init().then(() => {
      if (snpeffRuns.length > 0 && selectedRunId === null) {
        selectedRunId = snpeffRuns[0].id;
      }
    });
    await snpEffStore.init();
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
      (evt: any) => handleProgressEvent(evt.payload)
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
    } catch (e) {
      dbError = String(e);
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
      (evt: any) => {
        const p = evt.payload as { bytesDownloaded?: number; bytesTotal?: number; done: boolean; extracting?: boolean; error?: string };
        handleProgressEvent(p);
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

    try {
      const { data: dataDir } = await api.invoke('lia_fs_paths') as { data: string; cache: string };
      const outDir  = `${dataDir}/tool-outputs`;
      const outPath = `${outDir}/snpeff-${runId}.vcf`;

      annotationStatus = null;
      const result = await runNativeTool('java', [
        '-Xmx4g',
        '-jar', snpEffStore.config.jarPath,
        'ann',
        '-dataDir', snpEffStore.config.dataDir,
        '-noStats',
        '-noLog',
        genome,
        filePath,
      ], undefined, (line) => { if (line.trim()) annotationStatus = line.trim(); });

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

      await snpEffStore.touchGenome(genome);
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
      running          = false;
      startedAt        = null;
      annotationStatus = null;
      selectedRunId    = runId;
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
          <Card class="p-5 space-y-3">
            <h2 class="text-sm font-semibold text-zinc-800">2 — Genome database</h2>

            <!-- Genome list -->
            <!-- Search -->
            <div class="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
              <svg class="shrink-0 text-zinc-400" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                bind:value={genomeSearch}
                placeholder="Search genomes…"
                class="flex-1 text-xs bg-transparent outline-none text-zinc-700 placeholder:text-zinc-400"
              />
              {#if genomeSearch}
                <button onclick={() => genomeSearch = ''} class="text-zinc-400 hover:text-zinc-600">
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
                    {isSelected ? 'bg-brand/5' : 'hover:bg-zinc-50'}
                    {dbDownloading && !isDownloading ? 'cursor-default' : 'cursor-pointer'}"
                >
                  <!-- Status dot -->
                  <div class="h-2 w-2 rounded-full shrink-0
                    {isDownloading ? 'bg-brand animate-pulse' : downloaded ? 'bg-emerald-500' : 'bg-zinc-300'}">
                  </div>

                  <!-- Label + progress -->
                  <div class="flex-1 min-w-0">
                    <p class="text-xs {isSelected ? 'font-medium text-brand' : 'text-zinc-700'} truncate">{g.label}</p>
                    {#if isDownloading}
                      {#if dbExtracting}
                        <p class="text-[10px] text-zinc-400 mt-0.5">Extracting…</p>
                      {:else if dbBytesTotal}
                        {@const pct = Math.round((dbBytesDownloaded / dbBytesTotal) * 100)}
                        <div class="flex items-center gap-2 mt-1">
                          <div class="flex-1 bg-zinc-200 rounded-full h-1">
                            <div class="bg-brand h-1 rounded-full transition-all" style="width:{pct}%"></div>
                          </div>
                          <span class="text-[10px] text-zinc-400 shrink-0">
                            {pct}% · {(dbBytesDownloaded / 1_048_576).toFixed(0)} / {(dbBytesTotal / 1_048_576).toFixed(0)} MB
                          </span>
                        </div>
                      {:else}
                        <p class="text-[10px] text-zinc-400 mt-0.5">Connecting…</p>
                      {/if}
                      {#if dbError}
                        <p class="text-[10px] text-red-600 mt-0.5 font-mono truncate">{dbError}</p>
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
                        class="text-[10px] text-zinc-400 hover:text-red-500 px-2 py-0.5 rounded border border-transparent hover:border-red-200 transition-colors"
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
              <p class="text-[11px] text-zinc-500">Custom genome ID (overrides selection above):</p>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  bind:value={customGenome}
                  disabled={dbDownloading}
                  placeholder="e.g. GRCh38.mane.1.5.refseq"
                  class="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-mono
                         placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand/30
                         disabled:opacity-50"
                />
                {#if customGenome.trim()}
                  <button onclick={() => customGenome = ''} class="text-xs text-zinc-400 hover:text-zinc-600">Clear</button>
                {/if}
              </div>
              {#if customGenome.trim()}
                <p class="text-[10px] text-zinc-400">
                  Active: <code class="font-mono text-zinc-600">{effectiveGenome}</code>
                  {#if genomeChecking}
                    <span class="ml-1 text-zinc-400">· checking…</span>
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
              <h2 class="text-sm font-semibold text-zinc-800">3 — Annotate variants</h2>

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
                  disabled={!filePath || running}
                  loading={running}
                  onclick={runAnnotation}
                >
                  Run annotation
                </Button>
                {#if running && startedAt}
                  <span class="text-xs text-zinc-400">Elapsed: {fmtDuration(startedAt, now)}</span>
                {/if}
              </div>
              {#if annotationStatus}
                <p class="text-[10px] text-zinc-400 font-mono truncate">{annotationStatus}</p>
              {/if}
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
