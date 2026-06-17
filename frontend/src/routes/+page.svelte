<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { jobsStore, type JobEntry } from '$lib/stores/jobs.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { fmtDuration } from '$lib/utils';

  const TOOL_LABELS: Record<string, string> = {
    fastqc: 'FastQC',
    bwa: 'BWA-MEM2',
    minimap2: 'Minimap2',
    bcftools: 'BCFtools',
  };
  function toolLabel(tool: string) { return TOOL_LABELS[tool] ?? tool; }

  const recentAnalyses = $derived(analysisRuns.runs.slice(0, 5));
  const recentJobs = $derived(
    [...jobsStore.jobs]
      .sort((a, b) => b.started_at_ms - a.started_at_ms)
      .slice(0, 4)
  );

  function jobStatusVariant(job: JobEntry): 'running' | 'done' | 'failed' | 'killed' {
    if (job.status === 'Running') return 'running';
    if (job.status === 'Killed') return 'killed';
    if (typeof job.status === 'object' && 'Done' in job.status) return 'done';
    return 'failed';
  }

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  onMount(async () => {
    await Promise.all([
      jobsStore.refresh(),
      dataFiles.init(),
      analysisRuns.init(),
    ]);
  });
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Dashboard" description="Your bioinformatics workspace" />

  <div class="flex-1 overflow-y-auto p-6 space-y-6">

    <!-- Stats -->
    <div class="grid grid-cols-3 gap-4">
      <Card class="p-4">
        <p class="text-xs text-zinc-500 mb-1">Analyses run</p>
        <p class="text-2xl font-semibold text-zinc-900">{analysisRuns.runs.length}</p>
        <p class="text-xs text-zinc-400 mt-1">
          {analysisRuns.runs.filter(r => r.status === 'done').length} successful
        </p>
      </Card>

      <Card class="p-4">
        <p class="text-xs text-zinc-500 mb-1">Data files</p>
        <p class="text-2xl font-semibold text-zinc-900">{dataFiles.files.length}</p>
        <p class="text-xs text-zinc-400 mt-1">imported</p>
      </Card>

      <Card class="p-4">
        <p class="text-xs text-zinc-500 mb-1">Running jobs</p>
        <p class="text-2xl font-semibold text-zinc-900">{jobsStore.runningCount}</p>
        <p class="text-xs mt-1 {jobsStore.runningCount > 0 ? 'text-sky-500' : 'text-zinc-400'}">
          {jobsStore.runningCount > 0 ? 'Active' : 'Idle'}
        </p>
      </Card>
    </div>

    <!-- Quick launch -->
    <div>
      <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Quick launch</h2>
      <div class="grid grid-cols-3 gap-3">
        <Card hoverable class="p-4 flex items-start gap-3" onclick={() => goto('/data')}>
          <div class="h-8 w-8 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
          </div>
          <div>
            <p class="text-sm font-medium text-zinc-800">Import data</p>
            <p class="text-xs text-zinc-500 mt-0.5 leading-relaxed">Add FASTQ, BAM or VCF files</p>
          </div>
        </Card>

        <Card hoverable class="p-4 flex items-start gap-3" onclick={() => goto('/tools/qc')}>
          <div class="h-8 w-8 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4f39f6" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div>
            <p class="text-sm font-medium text-zinc-800">Run FastQC</p>
            <p class="text-xs text-zinc-500 mt-0.5 leading-relaxed">Quality control for FASTQ files</p>
          </div>
        </Card>

        <Card hoverable class="p-4 flex items-start gap-3" onclick={() => goto('/results')}>
          <div class="h-8 w-8 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
          </div>
          <div>
            <p class="text-sm font-medium text-zinc-800">View results</p>
            <p class="text-xs text-zinc-500 mt-0.5 leading-relaxed">Browse all analysis runs</p>
          </div>
        </Card>
      </div>
    </div>

    <!-- Recent analyses -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider">Recent analyses</h2>
        {#if analysisRuns.runs.length > 0}
          <Button variant="ghost" size="sm" onclick={() => goto('/results')}>View all</Button>
        {/if}
      </div>

      {#if recentAnalyses.length === 0}
        <Card class="p-6">
          <p class="text-center text-sm text-zinc-500">No analyses yet. Run a tool to get started.</p>
        </Card>
      {:else}
        <Card>
          <div class="divide-y divide-border">
            {#each recentAnalyses as run (run.id)}
              <button
                onclick={() => goto(`/results?run=${run.id}`)}
                class="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors text-left"
              >
                <span class="h-2 w-2 rounded-full shrink-0
                  {run.status === 'done' ? 'bg-emerald-500' : 'bg-red-500'}">
                </span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-zinc-800 truncate">{run.label}</p>
                  <p class="text-xs text-zinc-400 mt-0.5">{toolLabel(run.tool)} · {fmtDate(run.startedAt)}</p>
                </div>
                <span class="text-xs text-zinc-400 shrink-0">
                  {fmtDuration(run.startedAt, run.endedAt)}
                </span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-300 shrink-0">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            {/each}
          </div>
        </Card>
      {/if}
    </div>

    <!-- Recent jobs -->
    {#if recentJobs.length > 0}
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider">Recent jobs</h2>
          <Button variant="ghost" size="sm" onclick={() => goto('/jobs')}>View all</Button>
        </div>
        <Card>
          <div class="divide-y divide-border">
            {#each recentJobs as job}
              <div class="flex items-center gap-3 px-4 py-3">
                <Badge variant={jobStatusVariant(job)} pulse={job.status === 'Running'}>
                  {jobStatusVariant(job) === 'running' ? 'Running' : jobStatusVariant(job) === 'done' ? 'Done' : jobStatusVariant(job) === 'killed' ? 'Killed' : 'Failed'}
                </Badge>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-mono text-zinc-700 truncate">{job.cmd} {job.args.join(' ')}</p>
                </div>
                <span class="text-xs text-zinc-400 shrink-0 font-mono">
                  {fmtDuration(job.started_at_ms, job.ended_at_ms ?? undefined)}
                </span>
              </div>
            {/each}
          </div>
        </Card>
      </div>
    {/if}

  </div>
</div>
