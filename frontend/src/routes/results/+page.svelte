<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import RunLog from '$lib/components/ui/RunLog.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { analysisRuns, type AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { fmtDuration, fmtBytes } from '$lib/utils';
  import { liatir } from '$lib/api';
  import { exportToHtml } from '$lib/utils/export-result';
  import type { ToolOutput } from '$lib/types/tool-output';

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
  };

  function toolLabel(tool: string) { return TOOL_LABELS[tool] ?? tool; }

  // ── filters ────────────────────────────────────────────────────
  let activeTool = $state<string | 'all'>('all');
  let activeStatus = $state<'all' | 'done' | 'error'>('all');

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

  $effect(() => {
    const id = selectedId;
    if (!id) { loadedOutput = null; return; }
    loadingOutput = true;
    analysisRuns.loadOutput(id).then(out => {
      loadedOutput = out;
      loadingOutput = false;
    });
  });

  onMount(() => {
    analysisRuns.init().then(() => {
      const runParam = page.url.searchParams.get('run');
      if (runParam && analysisRuns.runs.find(r => r.id === runParam)) {
        selectedId = runParam;
      } else if (filtered.length > 0 && !selectedId) {
        selectedId = filtered[0].id;
      }
    });
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

  async function exportRun() {
    if (!selectedRun || !loadedOutput) return;
    const api = liatir();
    if (!api) return;
    exporting = true;
    try {
      const filename = `liatir-${toolLabel(selectedRun.tool).toLowerCase().replace(/\s+/g, '-')}-${selectedRun.label.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)}.html`;
      const dest = await api.desktop.files.save(filename);
      if (dest) {
        const html = exportToHtml(selectedRun, loadedOutput);
        await api.invoke('lia_write_file_path', { path: dest, content: html } as any);
      }
    } catch { /* cancelled */ } finally {
      exporting = false;
    }
  }

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
</script>

<div class="flex h-full overflow-hidden">

  <!-- List sidebar -->
  <div class="w-72 shrink-0 border-r border-border bg-surface flex flex-col">

    <!-- Filters -->
    <div class="px-3 pt-3 pb-2 border-b border-border flex gap-2">
      <Select
        value={activeTool}
        options={toolOptions}
        onchange={(v) => activeTool = v}
      />
      <Select
        value={activeStatus}
        options={[
          { value: 'all', label: 'Any status' },
          { value: 'done', label: 'Done' },
          { value: 'error', label: 'Error' },
        ]}
        onchange={(v) => activeStatus = v as typeof activeStatus}
      />
    </div>

    <!-- Count -->
    <div class="px-3 py-1.5 border-b border-border">
      <span class="text-[10px] text-zinc-400">{filtered.length} run{filtered.length !== 1 ? 's' : ''}</span>
    </div>

    <!-- Run list -->
    <div class="flex-1 overflow-y-auto py-1">
      {#if filtered.length === 0}
        <p class="text-xs text-zinc-400 text-center py-10 px-4 leading-relaxed">
          No runs match the current filters.
        </p>
      {:else}
        {#each filtered as run (run.id)}
          <div
            class="group relative flex items-start transition-colors
              {selectedId === run.id ? 'bg-brand/8' : 'hover:bg-surface-2'}"
          >
            <button
              onclick={() => selectedId = run.id}
              class="flex-1 text-left px-3 py-2.5 min-w-0"
            >
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="h-1.5 w-1.5 rounded-full shrink-0
                  {run.status === 'done' ? 'bg-emerald-500' : 'bg-red-500'}">
                </span>
                <p class="text-xs font-medium truncate
                  {selectedId === run.id ? 'text-brand' : 'text-zinc-700'}">
                  {run.label}
                </p>
              </div>
              <p class="text-[10px] text-zinc-400 pl-3">
                {toolLabel(run.tool)} · {fmtDate(run.startedAt)} · {fmtDuration(run.startedAt, run.endedAt)}{run.outputSize != null ? ' · ' + fmtBytes(run.outputSize) : ''}
              </p>
            </button>
            <button
              onclick={() => deleteRun(run)}
              aria-label="Delete"
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

  <!-- Detail panel -->
  <div class="flex-1 flex flex-col overflow-hidden">
    <PageHeader
      title="Results"
      description="Analysis run history across all tools"
    />

    <div class="flex-1 overflow-y-auto p-6">
      {#if analysisRuns.runs.length === 0}
        <div class="flex flex-col items-center justify-center h-full text-center gap-3">
          <div class="h-12 w-12 rounded-xl bg-zinc-100 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <p class="text-sm font-medium text-zinc-700">No analyses yet</p>
          <p class="text-xs text-zinc-400 max-w-xs">Run a tool to see results here.</p>
        </div>

      {:else if !selectedRun}
        <div class="flex flex-col items-center justify-center h-full text-center">
          <p class="text-sm text-zinc-400">Select a run from the list to view results.</p>
        </div>

      {:else if selectedRun.status === 'error'}
        <div>
          <div class="flex items-center justify-between mb-4">
            <div>
              <p class="text-sm font-semibold text-zinc-800">{selectedRun.label}</p>
              <p class="text-xs text-zinc-400 mt-0.5">
                {toolLabel(selectedRun.tool)} · {fmtDate(selectedRun.startedAt)} · {fmtDuration(selectedRun.startedAt, selectedRun.endedAt)}{selectedRun.outputSize != null ? ' · ' + fmtBytes(selectedRun.outputSize) : ''}
              </p>
            </div>
          </div>
          <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono" data-selectable>
            {selectedRun.error ?? 'Unknown error'}
          </div>
          <RunLog runId={selectedId} />
        </div>

      {:else if loadingOutput}
        <div class="flex justify-center py-16">
          <svg class="animate-spin h-5 w-5 text-zinc-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
        </div>

      {:else if loadedOutput}
        <div>
          <div class="flex items-center justify-between mb-4">
            <div>
              <p class="text-sm font-semibold text-zinc-800">{selectedRun.label}</p>
              <p class="text-xs text-zinc-400 mt-0.5">
                {toolLabel(selectedRun.tool)} · {fmtDate(selectedRun.startedAt)} · {fmtDuration(selectedRun.startedAt, selectedRun.endedAt)}{selectedRun.outputSize != null ? ' · ' + fmtBytes(selectedRun.outputSize) : ''}
              </p>
            </div>
            <button
              onclick={exportRun}
              disabled={exporting}
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border
                     text-xs text-zinc-600 hover:text-zinc-800 hover:bg-surface-2
                     disabled:opacity-50 disabled:cursor-default transition-colors"
            >
              {#if exporting}
                <svg class="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Exporting…
              {:else}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export HTML
              {/if}
            </button>
          </div>
          <ToolResultView output={loadedOutput} />
          <RunLog runId={selectedId} />
        </div>
      {/if}
    </div>
  </div>
</div>
