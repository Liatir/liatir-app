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
  import SnpEffSuiteManager from '$lib/components/tools/SnpEffSuiteManager.svelte';
  import { DEP_REQUIREMENTS } from '$lib/data/dep-requirements';
  import { liatir } from '$lib/api';
  import { beginDirectNativeToolRun } from '$lib/execution/direct-native-tool';
  import { ensureRunOutputDir } from '$lib/execution/run-storage';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { snpEffStore } from '$lib/stores/snpeff.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { fmtDuration, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { runNativeTool } from '$lib/utils/native-tool';
  import { notify } from '$lib/utils/notify';
  import {
    SNPSIFT_FILTER_PRESETS,
    resolveSnpSiftFilterExpression,
    type SnpSiftFilterPresetId,
  } from '$lib/tools/variants/snpsift';
  import type { ToolOutput } from '$lib/types/tool-output';
  import type { RunOutputFile } from '$lib/stores/analysisRuns.svelte';

  const TOOL_ID = 'snpsift-filter';
  let depStatus = $state<DepStatus>('checking');
  let filePath = $state('');
  let presetId = $state<SnpSiftFilterPresetId>('high-impact');
  let minimumQuality = $state(30);
  let customExpression = $state('');
  let running = $state(false);
  let startedAt = $state<number | null>(null);
  let now = $state(Date.now());
  let logLines = $state<string[]>([]);
  let activeExecutionRunId = $state<string | null>(null);
  let selectedRunId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);

  const runs = $derived(analysisRuns.byTool(TOOL_ID));
  const vcfFiles = $derived(dataFiles.byExt('vcf', 'vcf.gz'));
  const selectedPreset = $derived(SNPSIFT_FILTER_PRESETS.find((preset) => preset.id === presetId)!);
  const selectedRun = $derived(runs.find((run) => run.id === selectedRunId) ?? null);
  const selectedRunOutputFiles = $derived(selectedRun?.outputFiles ?? []);
  const displayError = $derived<string | null>(
    selectedRun?.status === 'error' ? (selectedRun.error ?? 'Unknown error') : null,
  );

  $effect(() => {
    if (!running) return;
    const id = setInterval(() => now = Date.now(), 1000);
    return () => clearInterval(id);
  });

  $effect(() => {
    const id = selectedRunId;
    if (!id) { loadedOutput = null; return; }
    loadingOutput = true;
    analysisRuns.loadOutput(id).then((output) => {
      loadedOutput = output;
      loadingOutput = false;
    });
  });

  onMount(async () => {
    dataFiles.init();
    analysisRuns.init();
    await Promise.all([snpEffStore.init(), settingsStore.init()]);
  });

  function basename(path: string) {
    return path.split(/[\\/]/).pop() ?? path;
  }

  function resolvedFilter() {
    return resolveSnpSiftFilterExpression(presetId, { minimumQuality, customExpression });
  }

  function expressionPreview() {
    try { return resolvedFilter().expression; } catch { return ''; }
  }

  async function runFilter() {
    if (!filePath || running) return;
    let resolved;
    let runtime;
    try {
      resolved = resolvedFilter();
      runtime = await snpEffStore.captureSnpSiftRuntime();
      if (!runtime.snpSiftJar) throw new Error('SnpSift.jar is unavailable.');
    } catch (error) {
      await notify('SnpSift is not ready', String(error));
      return;
    }

    const api = liatir();
    if (!api) return;
    running = true;
    selectedRunId = null;
    startedAt = Date.now();
    const runId = crypto.randomUUID();
    const t0 = startedAt;
    const fileName = basename(filePath);
    const fileSize = dataFiles.files.find((file) => file.path === filePath)?.size;
    const inputSizes = fileSize == null ? undefined : [fileSize];
    const params = {
      preset: resolved.preset.id,
      presetLabel: resolved.preset.label,
      expression: resolved.expression,
      requiresAnn: resolved.preset.requiresAnn,
      snpeffSuiteVersion: runtime.suiteVersion,
      snpeffSuiteSha256: runtime.suiteArchiveSha256,
      snpeffSuiteSource: runtime.source,
    };
    const execution = await beginDirectNativeToolRun({
      runId,
      toolId: TOOL_ID,
      label: fileName,
      inputs: [filePath],
      params,
      startedAt: t0,
    }).catch(async (error) => {
      await notify('SnpSift Filter failed', String(error));
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
      const outPath = `${outDir}/filtered.vcf`;
      const java = settingsStore.javaPath || 'java';
      logLines = [`$ java -Xmx1g -jar SnpSift.jar filter '${resolved.expression}' ${fileName}`];
      const result = await runNativeTool(
        java,
        ['-Xmx1g', '-jar', runtime.snpSiftJar, 'filter', resolved.expression, filePath],
        undefined,
        (line) => { if (line.trim() && logLines.length < 500) logLines.push(line); },
        execution.nativeOptions({
          stdoutPath: outPath,
          metadata: {
            snpeffSuiteVersion: runtime.suiteVersion,
            snpeffSuiteSha256: runtime.suiteArchiveSha256,
            snpeffSuiteSource: runtime.source,
            snpsiftFilterPreset: resolved.preset.id,
            snpsiftFilterExpression: resolved.expression,
          },
        }),
      );
      if (!result.ok) throw new Error(result.stderr || `SnpSift Filter exited with code ${result.exitCode}`);

      const outputFiles: RunOutputFile[] = [{
        label: 'Filtered VCF',
        path: outPath,
        ext: 'vcf',
        size: await api.invoke('lia_file_size', { path: outPath }) as number,
      }];
      const output: ToolOutput = { sections: [{
        type: 'stats',
        cols: 2,
        items: [
          { label: 'Preset', value: resolved.preset.label },
          { label: 'Expression', value: resolved.expression },
        ],
      }, {
        type: 'text',
        label: 'Output',
        content: `Filtered variants written to ${basename(outPath)}.`,
      }] };
      const endedAt = Date.now();
      logLines.push(`✓ Filtering complete in ${fmtDuration(t0, endedAt)}`);
      await execution.finalize('done', {
        id: runId,
        tool: TOOL_ID,
        label: fileName,
        inputs: [filePath],
        inputSizes,
        params,
        startedAt: t0,
        endedAt,
        durationMs: endedAt - t0,
        output,
        outputFiles,
        sideEffects: [],
        error: null,
        log: [...logLines],
      });
      await notify('SnpSift Filter complete', `${fileName} filtered in ${fmtDuration(t0, endedAt)}`, endedAt - t0);
    } catch (error) {
      const endedAt = Date.now();
      const cancelled = execution.isCancelled(error);
      const message = cancelled ? 'SnpSift Filter run was cancelled.' : String(error);
      logLines.push(cancelled ? `■ ${message}` : `✗ Error: ${message}`);
      await execution.finalize(cancelled ? 'cancelled' : 'error', {
        id: runId,
        tool: TOOL_ID,
        label: fileName,
        inputs: [filePath],
        inputSizes,
        params,
        startedAt: t0,
        endedAt,
        durationMs: endedAt - t0,
        output: null,
        outputFiles: [],
        sideEffects: [],
        error: message,
        log: [...logLines],
      });
      await notify(cancelled ? 'SnpSift Filter cancelled' : 'SnpSift Filter failed', message);
    } finally {
      running = false;
      startedAt = null;
      activeExecutionRunId = null;
      selectedRunId = runId;
    }
  }

  async function deleteRun(id: string, label: string) {
    const accepted = await confirm({
      title: 'Delete run',
      message: `Delete the run for "${label}"?`,
      confirmLabel: 'Delete',
    });
    if (!accepted) return;
    if (selectedRunId === id) selectedRunId = runs.find((run) => run.id !== id)?.id ?? null;
    await analysisRuns.remove(id);
  }

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
</script>

<div class="flex h-full overflow-hidden">
  <div class="w-52 shrink-0 border-r border-border bg-surface flex flex-col">
    <div class="flex items-center justify-between px-3 py-3 border-b border-border">
      <span class="text-xs font-medium text-text-secondary">Run history</span>
      {#if runs.length > 0}<span class="text-[10px] text-text-subtle">{runs.length}</span>{/if}
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
                <p class="text-xs font-medium truncate">{run.label}</p>
              </div>
              <p class="text-[10px] text-text-subtle pl-3">{fmtDate(run.startedAt)} · {fmtDuration(run.startedAt, run.endedAt)}</p>
            </button>
            <button onclick={() => deleteRun(run.id, run.label)} aria-label="Delete run" class="opacity-0 group-hover:opacity-100 p-1.5 mt-2 mr-1.5 text-text-subtle hover:text-red-500 rounded">×</button>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <div class="flex-1 flex flex-col overflow-hidden">
    <PageHeader title="SnpSift Filter" description="Keep the variants that match a biological or quality rule">
      {#snippet actions()}<Button variant="ghost" size="sm" onclick={() => goto('/tools')}>← Back</Button>{/snippet}
    </PageHeader>
    <div class="flex-1 overflow-y-auto p-6 space-y-5">
      <DepCheck req={DEP_REQUIREMENTS.java} onStatusChange={(status) => depStatus = status} />

      <SnpEffSuiteManager />

      {#if depStatus === 'ok'}
        <Card class="p-5 space-y-4">
          <div>
            <h2 class="text-sm font-semibold text-text">Filter variants</h2>
            <p class="mt-1 text-xs text-text-secondary leading-relaxed">
              Choose a readable preset, or enter the underlying SnpSift expression yourself.
            </p>
          </div>

          <FilePickerPopup files={vcfFiles} value={filePath} label="VCF file" emptyText="No VCF files in Data yet." disabled={running} onchange={(path) => filePath = path} />

          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {#each SNPSIFT_FILTER_PRESETS as preset}
              <button
                onclick={() => presetId = preset.id}
                class="rounded-lg border px-3 py-2 text-left transition-colors {presetId === preset.id ? 'border-brand bg-brand/5' : 'border-border hover:border-brand/40'}"
              >
                <span class="block text-xs font-medium {presetId === preset.id ? 'text-brand' : 'text-text'}">{preset.label}</span>
                <span class="mt-0.5 block text-[10px] leading-relaxed text-text-subtle">{preset.description}</span>
              </button>
            {/each}
          </div>

          {#if presetId === 'minimum-quality'}
            <label class="block text-xs text-text-secondary">
              Minimum VCF quality score
              <input type="number" min="0" step="1" bind:value={minimumQuality} class="mt-1 block w-40 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs" />
            </label>
          {:else if presetId === 'custom'}
            <label class="block text-xs text-text-secondary">
              SnpSift Filter expression
              <textarea bind:value={customExpression} rows="3" placeholder="e.g. (QUAL >= 30) & (DP >= 10)" class="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand/30"></textarea>
            </label>
          {/if}

          {#if selectedPreset.requiresAnn}
            <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 leading-relaxed" data-testid="snpsift-ann-warning">
              This preset reads the ANN field, which is the annotation SnpEff adds to a VCF. Run SnpEff first if your file does not contain ANN.
            </div>
          {/if}

          {#if expressionPreview()}
            <div class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[11px]">
              <span class="text-text-subtle">Exact expression: </span><code class="font-mono text-text-secondary">{expressionPreview()}</code>
            </div>
          {/if}

          <div class="flex items-center gap-3">
            <Button variant="primary" testId="snpsift-filter-run" disabled={!filePath || (!snpEffStore.active && !snpEffStore.config.externalJarPath) || running} loading={running} onclick={runFilter}>Run filter</Button>
            {#if running && activeExecutionRunId}
              <Button variant="secondary" testId="snpsift-filter-cancel" onclick={() => executionRuns.cancel(activeExecutionRunId!)}>Cancel</Button>
            {/if}
            {#if running && startedAt}<span class="text-xs text-text-subtle">Elapsed: {fmtDuration(startedAt, now)}</span>{/if}
          </div>
          <TerminalOutput lines={logLines} {running} />
        </Card>

        {#if displayError}
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono">{sanitizeLocalPathsForDisplay(displayError, 2)}</div>
          <RunRecord runId={selectedRunId} />
        {:else if loadingOutput}
          <div class="flex justify-center py-12"><span class="text-xs text-text-subtle">Loading result…</span></div>
        {:else if loadedOutput}
          <div>
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-xs font-medium text-text-secondary">{selectedRun?.label ?? 'Result'}</h2>
              {#if selectedRun}<span class="text-xs text-text-subtle">{fmtDate(selectedRun.startedAt)} · {fmtDuration(selectedRun.startedAt, selectedRun.endedAt)}</span>{/if}
            </div>
            <ToolResultView output={loadedOutput} outputFiles={selectedRunOutputFiles} />
            <RunRecord runId={selectedRunId} />
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>
