<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { offlab } from '$lib/api';
  import { fmtDuration } from '$lib/utils';

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
  let depOk = $state<boolean | null>(null);

  onMount(async () => {
    // check if fastqc WASM is listed
    const api = offlab();
    if (!api) return;
    try {
      const modules = await api.plugins.list();
      depOk = modules.some((m: string) => m.includes('fastqc'));
    } catch {
      depOk = false;
    }
  });

  async function pickFile() {
    const api = offlab();
    if (!api) return;
    try {
      const picked = await api.desktop.files.open({
        multiple: false,
        filters: [{ name: 'FASTQ', extensions: ['fastq', 'fq', 'fastq.gz', 'fq.gz'] }],
      });
      if (typeof picked === 'string') filePath = picked;
    } catch (e) {
      console.error(e);
    }
  }

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

  function qualityColor(q: number): string {
    if (q >= 30) return 'bg-emerald-500';
    if (q >= 20) return 'bg-amber-400';
    return 'bg-red-500';
  }

  const maxQ = $derived(
    result ? Math.max(...result.qualityPerPosition, 40) : 40
  );
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

    {#if depOk === false}
      <div class="rounded-xl border border-amber-700/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
        FastQC WASM module not loaded. Add <code class="font-mono text-amber-200">fastqc.wasm</code> via Settings to enable analysis.
      </div>
    {/if}

    <!-- Input form -->
    <Card class="p-5 space-y-4">
      <h2 class="text-sm font-semibold text-zinc-200">Input</h2>

      <div>
        <label for="fastq-input" class="block text-xs text-zinc-400 mb-1.5">FASTQ file</label>
        <div class="flex gap-2">
          <input
            id="fastq-input"
            data-selectable
            bind:value={filePath}
            placeholder="/path/to/reads.fastq"
            class="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2
                   text-sm text-zinc-200 placeholder:text-zinc-600 outline-none
                   focus:border-indigo-500 transition-colors"
          />
          <Button variant="secondary" size="md" onclick={pickFile}>Browse</Button>
        </div>
      </div>

      <div>
        <label for="max-reads" class="block text-xs text-zinc-400 mb-1.5">
          Max reads
          <span class="text-zinc-600">(optional — leave blank for all)</span>
        </label>
        <input
          id="max-reads"
          data-selectable
          type="number"
          bind:value={maxReads}
          min="1000"
          step="10000"
          placeholder="e.g. 100000"
          class="w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2
                 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none
                 focus:border-indigo-500 transition-colors"
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
          <span class="text-xs text-zinc-500">
            Elapsed: {startedAt ? fmtDuration(startedAt) : '—'}
          </span>
        {/if}
      </div>
    </Card>

    <!-- Error -->
    {#if error}
      <div class="rounded-xl border border-red-700/40 bg-red-500/10 px-4 py-3 text-sm text-red-300 font-mono" data-selectable>
        {error}
      </div>
    {/if}

    <!-- Results -->
    {#if result}
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider">Results</h2>
          {#if duration}
            <span class="text-xs text-zinc-600">Completed in {duration}</span>
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
              <p class="text-lg font-semibold text-zinc-100">{stat.value}</p>
            </Card>
          {/each}
        </div>

        <!-- Quality row -->
        <div class="grid grid-cols-3 gap-3">
          <Card class="p-4">
            <p class="text-xs text-zinc-500 mb-1">Mean Quality</p>
            <p class="text-2xl font-semibold {result.meanQuality >= 30 ? 'text-emerald-400' : result.meanQuality >= 20 ? 'text-amber-400' : 'text-red-400'}">
              Q{result.meanQuality.toFixed(1)}
            </p>
          </Card>
          <Card class="p-4">
            <p class="text-xs text-zinc-500 mb-1">Read Length Range</p>
            <p class="text-sm font-semibold text-zinc-200">
              {result.minLength} – {result.maxLength} bp
            </p>
          </Card>
          <Card class="p-4">
            <p class="text-xs text-zinc-500 mb-1">Quality Grade</p>
            <p class="text-sm font-semibold {result.meanQuality >= 30 ? 'text-emerald-400' : result.meanQuality >= 20 ? 'text-amber-400' : 'text-red-400'}">
              {result.meanQuality >= 30 ? 'Excellent' : result.meanQuality >= 20 ? 'Acceptable' : 'Poor'}
            </p>
          </Card>
        </div>

        <!-- Per-position quality chart -->
        {#if result.qualityPerPosition.length > 0}
          <Card class="p-4">
            <p class="text-xs text-zinc-500 mb-4">Per-position Mean Quality</p>
            <div class="flex items-end gap-px h-24 w-full">
              {#each result.qualityPerPosition as q, i}
                <div
                  class="flex-1 rounded-sm {qualityColor(q)} opacity-80 min-w-[1px]"
                  style="height: {Math.max(4, (q / maxQ) * 96)}px"
                  title="Pos {i + 1}: Q{q.toFixed(1)}"
                ></div>
              {/each}
            </div>
            <div class="flex justify-between mt-2 text-[10px] text-zinc-600">
              <span>Position 1</span>
              <span>Position {result.qualityPerPosition.length}</span>
            </div>
          </Card>
        {/if}
      </div>
    {/if}

  </div>
</div>
