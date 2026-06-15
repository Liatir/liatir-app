<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { jobsStore, type JobEntry } from '$lib/stores/jobs.svelte';
  import { fmtDuration, fmtTime } from '$lib/utils';
  import { offlab } from '$lib/api';

  let appVersion = $state<string | null>(null);

  const recentJobs = $derived(
    [...jobsStore.jobs]
      .sort((a, b) => b.started_at_ms - a.started_at_ms)
      .slice(0, 5)
  );

  function jobStatusVariant(job: JobEntry): 'running' | 'done' | 'failed' | 'killed' {
    if (job.status === 'Running') return 'running';
    if (job.status === 'Killed') return 'killed';
    if (typeof job.status === 'object' && 'Done' in job.status) return 'done';
    return 'failed';
  }

  function jobStatusLabel(job: JobEntry): string {
    if (job.status === 'Running') return 'Running';
    if (job.status === 'Killed') return 'Killed';
    if (typeof job.status === 'object' && 'Done' in job.status) return 'Done';
    return 'Failed';
  }

  onMount(async () => {
    const api = offlab();
    if (api) {
      try {
        const info = await api.desktop.app.getInfo();
        appVersion = info?.version ?? null;
      } catch {}
    }
    await jobsStore.refresh();
  });

  const quickTools = [
    { label: 'Run FastQC', description: 'Quality control for FASTQ files', href: '/tools/qc' },
    { label: 'Check Dependencies', description: 'Verify installed bioinformatics tools', href: '/deps' },
    { label: 'Monitor Jobs', description: 'View running and completed processes', href: '/jobs' },
  ];
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Dashboard" description="Welcome to Offlab — your bioinformatics workspace" />

  <div class="flex-1 overflow-y-auto p-6 space-y-6">
    <!-- Stats row -->
    <div class="grid grid-cols-3 gap-4">
      <Card class="p-4">
        <p class="text-xs text-zinc-500 mb-1">Running Jobs</p>
        <p class="text-2xl font-semibold text-zinc-100">{jobsStore.runningCount}</p>
        {#if jobsStore.runningCount > 0}
          <p class="text-xs text-sky-400 mt-1">Active</p>
        {:else}
          <p class="text-xs text-zinc-600 mt-1">Idle</p>
        {/if}
      </Card>

      <Card class="p-4">
        <p class="text-xs text-zinc-500 mb-1">Total Jobs</p>
        <p class="text-2xl font-semibold text-zinc-100">{jobsStore.jobs.length}</p>
        <p class="text-xs text-zinc-600 mt-1">this session</p>
      </Card>

      <Card class="p-4">
        <p class="text-xs text-zinc-500 mb-1">App Version</p>
        <p class="text-2xl font-semibold text-zinc-100">{appVersion ?? '—'}</p>
        <p class="text-xs text-zinc-600 mt-1">Offlab</p>
      </Card>
    </div>

    <!-- Quick actions -->
    <div>
      <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Quick Actions</h2>
      <div class="grid grid-cols-3 gap-3">
        {#each quickTools as tool}
          <Card
            hoverable
            class="p-4"
            onclick={() => goto(tool.href)}
          >
            <p class="text-sm font-medium text-zinc-200">{tool.label}</p>
            <p class="text-xs text-zinc-500 mt-1 leading-relaxed">{tool.description}</p>
          </Card>
        {/each}
      </div>
    </div>

    <!-- Recent jobs -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider">Recent Jobs</h2>
        <Button variant="ghost" size="sm" onclick={() => goto('/jobs')}>View all</Button>
      </div>

      {#if jobsStore.loading}
        <div class="flex justify-center py-8">
          <Spinner />
        </div>
      {:else if recentJobs.length === 0}
        <Card class="p-6">
          <p class="text-center text-sm text-zinc-500">No jobs yet. Run a tool to get started.</p>
        </Card>
      {:else}
        <Card>
          <div class="divide-y divide-border">
            {#each recentJobs as job}
              <div class="flex items-center gap-3 px-4 py-3">
                <Badge variant={jobStatusVariant(job)} pulse>
                  {jobStatusLabel(job)}
                </Badge>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-mono text-zinc-200 truncate">
                    {job.cmd} {job.args.join(' ')}
                  </p>
                  <p class="text-xs text-zinc-500 mt-0.5">{fmtTime(job.started_at_ms)}</p>
                </div>
                <span class="text-xs text-zinc-500 shrink-0">
                  {fmtDuration(job.started_at_ms, job.ended_at_ms ?? undefined)}
                </span>
              </div>
            {/each}
          </div>
        </Card>
      {/if}
    </div>
  </div>
</div>
