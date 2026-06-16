<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import InfoPopup from '$lib/components/ui/InfoPopup.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import { offlab } from '$lib/api';
  import { fmtDuration } from '$lib/utils';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import type { ToolOutput } from '$lib/types/tool-output';

  let maxReads = $state<number | undefined>(undefined);
  let filePath = $state('');
  let running = $state(false);
  let result = $state<ToolOutput | null>(null);
  let error = $state<string | null>(null);
  let startedAt = $state<number | null>(null);
  let duration = $state<string | null>(null);

  const fastqFiles = $derived(dataFiles.byExt('fastq', 'fastq.gz'));

  onMount(() => dataFiles.init());

  async function runFastqc() {
    if (!filePath) return;
    const api = offlab();
    if (!api) return;
    running = true;
    error = null;
    result = null;
    startedAt = Date.now();
    try {
      result = await api.qc.fastqc.run({ input: filePath, maxReads });
      duration = fmtDuration(startedAt, Date.now());
    } catch (e) {
      error = String(e);
    } finally {
      running = false;
    }
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader
    title="FastQC"
    description="FASTQ quality control analysis"
    info="FastQC analyses the quality of raw sequencing reads in FASTQ format. It reports per-base quality scores, GC content, read length distribution, and other metrics to help assess whether sequencing data is suitable for downstream analysis."
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

    <!-- Input -->
    <Card class="p-5 space-y-4">
      <h2 class="text-sm font-semibold text-zinc-800">Input</h2>

      <div>
        <label class="flex text-xs text-zinc-500 mb-1.5 items-center">
          FASTQ file
          <InfoPopup text="Select a FASTQ file (.fastq, .fq) or gzipped FASTQ (.fastq.gz, .fq.gz). The file must be imported in the Data section first." />
        </label>
        {#if fastqFiles.length === 0}
          <div class="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-3 text-sm text-zinc-400 flex items-center justify-between">
            No FASTQ files in Data yet.
            <a href="/data" class="text-brand text-xs font-medium hover:underline">Go to Data →</a>
          </div>
        {:else}
          <div class="space-y-1.5">
            {#each fastqFiles as file (file.id)}
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
                <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
                  {file.ext}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div>
        <label for="max-reads" class="flex text-xs text-zinc-500 mb-1.5 items-center">
          Max reads
          <InfoPopup text="Limit analysis to the first N reads. Useful for a quick preview of very large files. Leave blank to analyse all reads." />
          <span class="ml-1 text-zinc-400">(optional)</span>
        </label>
        <input
          id="max-reads"
          data-selectable
          type="number"
          bind:value={maxReads}
          min="1000"
          step="10000"
          placeholder="e.g. 100000"
          class="w-48 rounded-lg border border-border bg-surface-2 px-3 py-2
                 text-sm text-zinc-800 placeholder:text-zinc-400 outline-none
                 focus:border-brand transition-colors"
        />
      </div>

      <div class="flex items-center gap-3 pt-1">
        <Button
          variant="primary"
          disabled={!filePath || running}
          loading={running}
          onclick={runFastqc}
        >
          Run Analysis
        </Button>
        {#if running}
          <span class="text-xs text-zinc-400">
            Elapsed: {startedAt ? fmtDuration(startedAt) : '—'}
          </span>
        {/if}
      </div>
    </Card>

    <!-- Error -->
    {#if error}
      <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono" data-selectable>
        {error}
      </div>
    {/if}

    <!-- Results -->
    {#if result}
      <div class="space-y-1">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs font-medium text-zinc-400 uppercase tracking-wider">Results</h2>
          {#if duration}
            <span class="text-xs text-zinc-400">Completed in {duration}</span>
          {/if}
        </div>
        <ToolResultView output={result} />
      </div>
    {/if}

  </div>
</div>
