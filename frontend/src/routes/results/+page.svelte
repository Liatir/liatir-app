<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import RunRecord from '$lib/components/ui/RunRecord.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { analysisRuns, type AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { revealFailureMessage, revealRunDir, runDirPath } from '$lib/execution/run-storage';
  import { clickOutside } from '$lib/actions/clickOutside';

  /**
   * How many runs the prune action keeps. Not a cap: nothing is removed until the user asks, and
   * this only sets what "older runs" means when they do.
   */
  const KEEP_RECENT_RUNS = 100;

  /**
   * Below this width the run's actions no longer fit on the title row and collapse into a menu.
   * Measured on the row itself rather than the window: what changes width here is the detail panel,
   * which also depends on the run list beside it.
   */
  const ACTIONS_INLINE_MIN_WIDTH = 560;
  import { fmtDuration, fmtBytes, sanitizeLocalPathsForDisplay } from '$lib/utils';
  import { liatir } from '$lib/api';
  import { exportToHtml } from '$lib/utils/export-result';
  import { quentaDraftUrl } from '$lib/quenta/navigation';
  import { openQuentaWindow } from '$lib/quenta/window';
  import { toast } from '$lib/stores/toast.svelte';
  import type { ToolOutput } from '$lib/types/tool-output';
  import { externalWorkflowsStore } from '$lib/stores/externalWorkflows.svelte';
	import Icon from '@iconify/svelte';
	import PageContent from '$lib/components/layout/PageContent.svelte';
	import { HEADER_HEIGHT } from '$lib/_constants';

  const TOOL_LABELS: Record<string, string> = {
    pipeline: 'Pipeline',
    fastqc: 'FastQC',
    fastp: 'fastp',
    seqkit: 'SeqKit',
    'seqkit-stats': 'SeqKit stats',
    samtools: 'Samtools',
    'samtools-flagstat': 'Samtools flagstat',
    'samtools-faidx': 'Samtools faidx',
    'bwa-mem': 'BWA-MEM',
    minimap2: 'minimap2',
    bcftools: 'BCFtools',
    'bcftools-stats': 'BCFtools stats',
    'bcftools-filter': 'BCFtools filter',
    snpeff: 'SnpEff',
    'snpsift-filter': 'SnpSift Filter',
  };

  function toolLabel(tool: string) {
    if (tool.startsWith('external-workflow:')) {
      return externalWorkflowsStore.byId(tool.slice('external-workflow:'.length))?.name ?? 'External Workflow';
    }
    return TOOL_LABELS[tool] ?? tool;
  }

  // ── filters ────────────────────────────────────────────────────
  let activeTool = $state<string | 'all'>('all');
  let activeStatus = $state<'all' | 'done' | 'error' | 'cancelled'>('all');

  const allTools = $derived([...new Set(analysisRuns.runs.map(r => r.tool))]);
  const toolOptions = $derived([
    { value: 'all', label: 'All tools' },
    ...allTools.map(t => ({ value: t, label: toolLabel(t) })),
  ]);

  const filtered = $derived(analysisRuns.runs.filter(r => {
    if (activeTool !== 'all' && r.tool !== activeTool) return false;
    if (activeStatus !== 'all' && r.status !== activeStatus) return false;
    return true;
  }));

  // ── selection + output loading ─────────────────────────────────
  let selectedId = $state<string | null>(null);
  let loadedOutput = $state<ToolOutput | null>(null);
  let loadingOutput = $state(false);
  let exporting = $state(false);

  const selectedRun = $derived(filtered.find(r => r.id === selectedId) ?? null);

  // The run's actions: one row while there is space for it, a menu when there is not.
  let headerWidth = $state(0);
  let actionsOpen = $state(false);
  const compactActions = $derived(headerWidth > 0 && headerWidth < ACTIONS_INLINE_MIN_WIDTH);

  $effect(() => {
    const id = selectedId;
    actionsOpen = false;
    if (!id) { loadedOutput = null; return; }
    loadingOutput = true;
    analysisRuns.loadOutput(id).then(out => {
      loadedOutput = out;
      loadingOutput = false;
    });
  });

  let storesReady = $state(false);
  /** The last `?run=` this page acted on, so a user's own selection is not overridden on re-render. */
  let appliedRunParam: string | null = null;

  onMount(() => {
    Promise.all([analysisRuns.init(), externalWorkflowsStore.init()]).then(() => {
      storesReady = true;
    });
  });

  // Reacting to the parameter rather than reading it once on mount: Liatir routes client-side, so
  // opening a Result deep link while already on this page never remounts it. Read once, the link
  // silently did nothing and the run stayed unselected.
  $effect(() => {
    if (!storesReady) return;
    const runParam = page.url.searchParams.get('run');
    if (!runParam || runParam === appliedRunParam) return;
    if (analysisRuns.runs.some(r => r.id === runParam)) {
      appliedRunParam = runParam;
      selectedId = runParam;
    }
  });

  // ── actions ────────────────────────────────────────────────────
  async function deleteRun(run: AnalysisRunMeta) {
    const ok = await confirm({
      title: 'Delete run',
      message: `Delete the ${toolLabel(run.tool)} run for "${run.label}"?`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    if (selectedId === run.id) {
      const next = filtered.find(r => r.id !== run.id);
      selectedId = next?.id ?? null;
    }
    await analysisRuns.remove(run.id);
  }

  /**
   * The explicit prune. Liatir never removes a run on its own, so this is the only thing that does.
   *
   * It says what it is about to destroy before doing it — including how many of the files are in
   * the user's Data library, because those are the ones they are likely to still be using. Deleting
   * silently and leaving the library full of entries pointing at nothing would be the worst of both.
   */
  async function pruneOldRuns() {
    const keep = KEEP_RECENT_RUNS;
    const doomed = analysisRuns.runs.slice(keep);
    if (doomed.length === 0) return;

    const directories = await Promise.all(doomed.map((run) => runDirPath(run.id)));
    const fileCount = doomed.reduce((total, run) => total + (run.outputFiles?.length ?? 0), 0);
    const inLibrary = dataFiles.countUnder(directories);

    const ok = await confirm({
      title: `Delete ${doomed.length} older ${doomed.length === 1 ? 'run' : 'runs'}`,
      message: [
        `This keeps the ${keep} most recent runs and deletes the rest, with everything they produced`,
        `— ${fileCount} ${fileCount === 1 ? 'file' : 'files'}, of which ${inLibrary} ${inLibrary === 1 ? 'is' : 'are'} in your Data library.`,
        'Deleted runs move to Liatir\'s trash; empty it to reclaim the disk space.',
      ].join(' '),
      confirmLabel: 'Delete runs',
    });
    if (!ok) return;

    if (selectedId && doomed.some((run) => run.id === selectedId)) selectedId = null;
    await analysisRuns.removeMany(doomed.map((run) => run.id));
    await dataFiles.removeUnder(directories);
    toast.success(`Deleted ${doomed.length} ${doomed.length === 1 ? 'run' : 'runs'}.`);
  }

  /** Shows the run's folder in Finder or Explorer. Says so when it could not, as the menu it may
   *  have been fired from is already closed by then. */
  async function openRunFolder(run: AnalysisRunMeta) {
    actionsOpen = false;
    const note = revealFailureMessage(await revealRunDir(run.id));
    if (note) toast.error(note);
  }

  async function exportRun() {
    actionsOpen = false;
    if (!selectedRun || !loadedOutput) return;
    const api = liatir();
    if (!api) return;
    exporting = true;
    try {
      const filename = `liatir-${toolLabel(selectedRun.tool).toLowerCase().replace(/\s+/g, '-')}-${selectedRun.label.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)}.html`;
      const dest = await api.desktop.files.save(filename);
      if (dest) {
        const html = await exportToHtml(selectedRun, loadedOutput);
        await api.invoke('lia_write_file_path', { path: dest, content: html } as any);
      }
    } catch { /* cancelled */ } finally {
      exporting = false;
    }
  }

  async function openQuentaForRun(run: AnalysisRunMeta, intent: 'explain-result' | 'explain-failure') {
    actionsOpen = false;
    try {
      await openQuentaWindow(quentaDraftUrl(intent, { kind: 'result', entityId: run.id }));
    } catch {
      toast.error('Quenta could not open in a separate window.');
    }
  }

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
</script>

<!--
  Everything you can do with the selected run, in one place at the top of it: explain it, export it,
  and open the folder it wrote. The folder used to sit alone under the result, which put the same
  run's actions in two different places — so `RunRecord` below is told not to repeat it here.

  `inMenu` is the same set stacked in the collapsed menu, so there is one definition of each action
  rather than two that can drift apart.
-->
{#snippet runActions(run: AnalysisRunMeta, failed: boolean, inMenu: boolean)}
  {@const itemClass = inMenu ? 'w-full' : ''}
  {@const itemStyle = inMenu ? 'justify-content: flex-start' : ''}
  <Button
    variant="secondary"
    size="sm"
    class="whitespace-nowrap {itemClass}"
    style={itemStyle}
    testId={failed ? 'result-explain-failure' : 'result-explain'}
    onclick={() => openQuentaForRun(run, failed ? 'explain-failure' : 'explain-result')}
  >
    <Icon icon="lucide:sparkles" class="h-3.5 w-3.5 shrink-0" />
    {failed ? 'Explain failure' : 'Explain result'}
  </Button>

  {#if !failed && loadedOutput}
    <Button
      variant="secondary"
      size="sm"
      class="whitespace-nowrap {itemClass}"
      style={itemStyle}
      loading={exporting}
      testId="result-export-html"
      onclick={exportRun}
    >
      {#if !exporting}
        <Icon icon="lucide:download" class="h-3.5 w-3.5 shrink-0" />
      {/if}
      {exporting ? 'Exporting…' : 'Export HTML'}
    </Button>
  {/if}

  <Button
    variant="secondary"
    size="sm"
    class="whitespace-nowrap {itemClass}"
    style={itemStyle}
    testId="open-run-folder"
    onclick={() => openRunFolder(run)}
  >
    <Icon icon="lucide:folder-open" class="h-3.5 w-3.5 shrink-0" />
    Open run folder
  </Button>
{/snippet}

{#snippet runHeader(run: AnalysisRunMeta, failed: boolean)}
  <div class="flex items-start justify-between gap-3 mb-4" bind:clientWidth={headerWidth}>
    <div class="min-w-0">
      <p class="text-sm font-semibold text-text truncate" title={run.label}>{run.label}</p>
      <p class="text-xs text-text-subtle mt-0.5 truncate">
        {toolLabel(run.tool)} · {fmtDate(run.startedAt)} · {fmtDuration(run.startedAt, run.endedAt)}{run.outputSize != null ? ' · ' + fmtBytes(run.outputSize) : ''}
      </p>
    </div>

    {#if compactActions}
      <div
        class="relative shrink-0"
        use:clickOutside={{ enabled: actionsOpen, onOutside: () => actionsOpen = false }}
      >
        <Button
          variant="secondary"
          size="sm"
          testId="result-actions-menu"
          onclick={() => actionsOpen = !actionsOpen}
        >
          Actions
          <Icon
            icon="lucide:chevron-down"
            class="h-3.5 w-3.5 shrink-0 transition-transform {actionsOpen ? 'rotate-180' : ''}"
          />
        </Button>
        {#if actionsOpen}
          <div class="absolute right-0 top-full z-20 mt-1 flex min-w-44 flex-col gap-1 rounded-lg
                      border border-border bg-surface p-1 shadow-lg">
            {@render runActions(run, failed, true)}
          </div>
        {/if}
      </div>
    {:else}
      <div class="flex items-center gap-2 shrink-0">
        {@render runActions(run, failed, false)}
      </div>
    {/if}
  </div>
{/snippet}

<div class="flex h-full overflow-hidden">

  <!-- List sidebar -->
  <div class="w-72 shrink-0 border-r border-border bg-surface flex flex-col">

    <!-- Filters -->
    <div class="px-3 pt-3 pb-3 border-b border-border flex items-end flex-wrap gap-2" style="height: {HEADER_HEIGHT}px;">
      <Select
        value={activeTool}
        options={toolOptions}
        onchange={(v) => activeTool = v}
        class="min-w-0 flex-[1_1_8rem] text-xs"
      />
      <Select
        value={activeStatus}
        options={[
          { value: 'all', label: 'Any status' },
          { value: 'done', label: 'Done' },
          { value: 'error', label: 'Error' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
        onchange={(v) => activeStatus = v as typeof activeStatus}
        class="min-w-0 flex-[1_1_7rem] text-[10px]"
      />
    </div>

    <!-- Count -->
    <div class="px-3 py-1.5 border-b border-border">
      <span class="text-[10px] text-text-subtle">{filtered.length} run{filtered.length !== 1 ? 's' : ''}</span>
    </div>

    <!-- Run list -->
    <div class="flex-1 overflow-y-auto py-1">
      {#if filtered.length === 0}
        <p class="text-xs text-text-subtle text-center py-10 px-4 leading-relaxed">
          No runs match the current filters.
        </p>
      {:else}
        {#each filtered as run (run.id)}
          <div
            class="group relative flex items-start transition-colors
              {selectedId === run.id ? 'bg-brand/8' : 'hover:bg-surface-2'}"
            data-testid="result-run"
            data-run-id={run.id}
          >
            <button
              data-testid="result-run-open"
              onclick={() => selectedId = run.id}
              class="flex-1 text-left px-3 py-2.5 min-w-0"
            >
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="h-1.5 w-1.5 rounded-full shrink-0
                  {run.status === 'done' ? 'bg-emerald-500' : run.status === 'cancelled' ? 'bg-amber-500' : 'bg-red-500'}">
                </span>
                <p class="text-xs font-medium truncate
                  {selectedId === run.id ? 'text-brand' : 'text-text-secondary'}">
                  {run.label}
                </p>
              </div>
              <p class="text-[10px] text-text-subtle pl-3">
                {toolLabel(run.tool)} · {fmtDate(run.startedAt)} · {fmtDuration(run.startedAt, run.endedAt)}{run.outputSize != null ? ' · ' + fmtBytes(run.outputSize) : ''}
              </p>
            </button>
            <button
              onclick={() => deleteRun(run)}
              aria-label="Delete"
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

  <!-- Detail panel -->
  <div class="flex-1 flex flex-col overflow-hidden">
    <PageHeader
      title="Results"
      description="Analysis run history across all tools"
    >
      {#snippet actions()}
        {#if analysisRuns.runs.length > KEEP_RECENT_RUNS}
          <Button variant="secondary" size="sm" onclick={pruneOldRuns}>
            Delete runs older than the last {KEEP_RECENT_RUNS}
          </Button>
        {/if}
      {/snippet}
    </PageHeader>

    <PageContent>
      <div class="flex-1 overflow-y-auto p-6">
        {#if analysisRuns.runs.length === 0}
          <div class="flex flex-col items-center justify-center h-full text-center gap-3">
            <div class="h-12 w-12 rounded-xl bg-surface-2 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="color: var(--color-text-subtle)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <p class="text-sm font-medium text-text-secondary">No analyses yet</p>
            <p class="text-xs text-text-subtle max-w-xs">Run a tool to see results here.</p>
          </div>

        {:else if !selectedRun}
          <div class="flex flex-col items-center justify-center h-full text-center">
            <div class="flex items-center justify-center mb-2 gap-1">
              <!-- <Icon icon="lucide:arrow-left" class="text-text-subtle/50 h-3 w-3"/> -->
              <Icon icon="lucide:list" class="text-text-subtle/50 h-6 w-6"/>
            </div>
            <p class="text-sm text-text-subtle">Select a run from the list to view results.</p>
          </div>

        {:else if selectedRun.status === 'error' || selectedRun.status === 'cancelled'}
          <div>
            {@render runHeader(selectedRun, true)}
            <div class="rounded-xl border px-4 py-3 text-sm font-mono
              {selectedRun.status === 'cancelled'
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-red-200 bg-red-50 text-red-700'}" data-selectable>
              {sanitizeLocalPathsForDisplay(selectedRun.error ?? 'Unknown error', 2)}
            </div>
            {#if loadedOutput}
              <div class="mt-4">
                <ToolResultView
                  output={loadedOutput}
                  outputFiles={selectedRun.outputFiles ?? []}
                  resultFolder={toolLabel(selectedRun.tool)}
                />
              </div>
            {/if}
            <RunRecord runId={selectedId} showOpenFolder={false} />
          </div>

        {:else if loadingOutput}
          <div class="flex justify-center py-16">
            <svg class="animate-spin h-5 w-5 text-text-subtle" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          </div>

        {:else}
          <div>
            {@render runHeader(selectedRun, false)}
            {#if loadedOutput}
                  <ToolResultView output={loadedOutput} outputFiles={selectedRun.outputFiles ?? []} resultFolder={toolLabel(selectedRun.tool)} />
            {:else}
              <div class="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-muted">
                This Result has no structured preview. Quenta can still use its metadata, files, and logs.
              </div>
            {/if}
            <RunRecord runId={selectedId} showOpenFolder={false} />
          </div>
        {/if}
      </div>
    </PageContent>
  </div>
</div>
