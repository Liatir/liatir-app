<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { offlab } from '$lib/api';
  import { fmtDuration } from '$lib/utils';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import Plotly from 'plotly.js-dist-min';

  interface FastqcResult {
    readCount: number;
    totalBases: number;
    meanLength: number;
    minLength: number;
    maxLength: number;
    meanQuality: number;
    gcContent: number;
    qualityPerPosition: number[];
  }

  let filePath = $state('');
  let maxReads = $state<number | undefined>(undefined);
  let running = $state(false);
  let result = $state<FastqcResult | null>(null);
  let error = $state<string | null>(null);
  let startedAt = $state<number | null>(null);
  let duration = $state<string | null>(null);

  let chartEl: HTMLDivElement;
  let chartMounted = false;

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

  function qualityGrade(q: number) {
    if (q >= 30) return { label: 'Excellent', color: 'text-emerald-600' };
    if (q >= 20) return { label: 'Acceptable', color: 'text-amber-600' };
    return { label: 'Poor', color: 'text-red-600' };
  }

  const grade = $derived(result ? qualityGrade(result.meanQuality) : { label: '', color: '' });

  function barColor(q: number): string {
    if (q >= 30) return '#10b981';
    if (q >= 20) return '#f59e0b';
    return '#ef4444';
  }

  $effect(() => {
    if (!result || !chartEl) return;

    const qs = result.qualityPerPosition;
    const xs = qs.map((_, i) => i + 1);

    Plotly.newPlot(
      chartEl,
      [
        {
          x: xs,
          y: qs,
          type: 'bar' as const,
          marker: { color: qs.map(barColor) },
          hovertemplate: 'Position %{x}<br>Q%{y:.1f}<extra></extra>',
        },
      ],
      {
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        margin: { l: 44, r: 12, t: 12, b: 40 },
        xaxis: {
          title: { text: 'Position (bp)', font: { size: 11, color: '#9ca3af' } },
          gridcolor: '#e2e2e8',
          color: '#6b7280',
          tickfont: { size: 10 },
          linecolor: '#e2e2e8',
        },
        yaxis: {
          title: { text: 'Mean Quality (Q)', font: { size: 11, color: '#9ca3af' } },
          gridcolor: '#e2e2e8',
          color: '#6b7280',
          tickfont: { size: 10 },
          range: [0, Math.max(42, ...qs) + 2],
          linecolor: '#e2e2e8',
        },
        shapes: [
          { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 30, y1: 30, line: { color: '#10b981', width: 1, dash: 'dot' } },
          { type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 20, y1: 20, line: { color: '#f59e0b', width: 1, dash: 'dot' } },
        ],
        showlegend: false,
        bargap: 0.1,
      },
      { responsive: true, displayModeBar: false }
    );
    chartMounted = true;
  });

  onDestroy(() => {
    if (chartEl && chartMounted) Plotly.purge(chartEl);
  });
</script>

<div class="flex flex-col h-full">
  <PageHeader title="FastQC" description="FASTQ quality control analysis">
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

    <!-- Input form -->
    <Card class="p-5 space-y-4">
      <h2 class="text-sm font-semibold text-zinc-800">Input</h2>

      <div>
        <label class="block text-xs text-zinc-500 mb-1.5">FASTQ file</label>
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
                  <span class="block text-sm font-medium {filePath === file.path ? 'text-brand' : 'text-zinc-800'} truncate">{file.name}</span>
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
        <label for="max-reads" class="block text-xs text-zinc-500 mb-1.5">
          Max reads
          <span class="text-zinc-400">(optional — leave blank for all)</span>
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
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-medium text-zinc-400 uppercase tracking-wider">Results</h2>
          {#if duration}
            <span class="text-xs text-zinc-400">Completed in {duration}</span>
          {/if}
        </div>

        <!-- Summary stats -->
        <div class="grid grid-cols-4 gap-3">
          {#each [
            { label: 'Reads', value: result.readCount.toLocaleString() },
            { label: 'Total Bases', value: result.totalBases >= 1e9
                ? `${(result.totalBases / 1e9).toFixed(2)} Gb`
                : result.totalBases >= 1e6
                ? `${(result.totalBases / 1e6).toFixed(1)} Mb`
                : `${result.totalBases.toLocaleString()} bp` },
            { label: 'Mean Length', value: `${result.meanLength.toFixed(0)} bp` },
            { label: 'GC Content', value: `${(result.gcContent * 100).toFixed(1)}%` },
          ] as stat}
            <Card class="p-4">
              <p class="text-xs text-zinc-500 mb-1">{stat.label}</p>
              <p class="text-lg font-semibold text-zinc-900">{stat.value}</p>
            </Card>
          {/each}
        </div>

        <!-- Quality row -->
        <div class="grid grid-cols-3 gap-3">
          <Card class="p-4">
            <p class="text-xs text-zinc-500 mb-1">Mean Quality</p>
            <p class="text-2xl font-semibold {grade.color}">
              Q{result.meanQuality.toFixed(1)}
            </p>
          </Card>
          <Card class="p-4">
            <p class="text-xs text-zinc-500 mb-1">Read Length Range</p>
            <p class="text-sm font-semibold text-zinc-800">
              {result.minLength} – {result.maxLength} bp
            </p>
          </Card>
          <Card class="p-4">
            <p class="text-xs text-zinc-500 mb-1">Quality Grade</p>
            <p class="text-sm font-semibold {grade.color}">{grade.label}</p>
          </Card>
        </div>

        <!-- Plotly quality-per-position chart -->
        {#if result.qualityPerPosition.length > 0}
          <Card class="p-4">
            <p class="text-xs text-zinc-500 mb-1">Per-position Mean Quality</p>
            <p class="text-[10px] text-zinc-400 mb-3">
              Green dotted line = Q30 · Amber = Q20 · Bars coloured by threshold
            </p>
            <div bind:this={chartEl} class="w-full h-52"></div>
          </Card>
        {/if}
      </div>
    {/if}

  </div>
</div>
