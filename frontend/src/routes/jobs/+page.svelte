<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { jobsStore, type JobBufferedOutput, type JobEntry } from '$lib/stores/jobs.svelte';
	import { fmtDuration, fmtTime } from '$lib/utils';
	import Icon from '@iconify/svelte/dist/OfflineIcon.svelte';

	let expandedJobId = $state<string | null>(null);
	let jobOutputs = $state<Record<string, JobBufferedOutput>>({});
	let outputLoading = $state<Record<string, boolean>>({});
	let interval: ReturnType<typeof setInterval>;

	function jobStatusVariant(job: JobEntry): 'running' | 'done' | 'failed' | 'killed' | 'neutral' {
		switch (job.status.type) {
			case 'running':
				return 'running';
			case 'done':
				return 'done';
			case 'failed':
				return 'failed';
			case 'killed':
				return 'killed';
			default:
				return 'neutral';
		}
	}

	function jobStatusLabel(job: JobEntry): string {
		switch (job.status.type) {
			case 'running':
				return 'Running';
			case 'done':
				return job.status.exitCode != null ? `Done (${job.status.exitCode})` : 'Done';
			case 'failed':
				return job.status.exitCode != null ? `Failed (${job.status.exitCode})` : 'Failed';
			case 'killed':
				return 'Killed';
			default:
				return 'Unknown';
		}
	}

	function jobTitle(job: JobEntry): string {
		return job.label?.trim() || job.cmd;
	}

	function jobSubtitle(job: JobEntry): string {
		const command = [job.cmd, ...job.args].join(' ');
		return job.kind ? `${job.kind} · ${command}` : command;
	}

	function terminalLines(lines: string[]): string[] {
		return lines.slice(-300);
	}

	function terminalLineClass(line: string): string {
		const lower = line.toLowerCase();
		if (lower.includes('error') || lower.includes('failed') || lower.includes('traceback'))
			return 'text-red-400';
		if (lower.includes('warning')) return 'text-amber-300';
		if (line.startsWith('$ ')) return 'text-sky-300';
		return 'text-zinc-300';
	}

	async function loadJobOutput(id: string) {
		outputLoading = { ...outputLoading, [id]: true };
		try {
			const output = await jobsStore.getOutput(id);
			if (output) jobOutputs = { ...jobOutputs, [id]: output };
		} finally {
			outputLoading = { ...outputLoading, [id]: false };
		}
	}

	async function toggleExpand(id: string) {
		expandedJobId = expandedJobId === id ? null : id;
		if (expandedJobId) await loadJobOutput(expandedJobId);
	}

	const sortedJobs = $derived([...jobsStore.jobs].sort((a, b) => b.startedAtMs - a.startedAtMs));

	onMount(() => {
		void jobsStore.refresh().then(() => {
			if (expandedJobId) void loadJobOutput(expandedJobId);
		});
		// poll every 2s while there are running jobs
		interval = setInterval(() => {
			if (jobsStore.runningCount > 0) {
				void jobsStore.refresh().then(() => {
					if (expandedJobId) void loadJobOutput(expandedJobId);
				});
			}
		}, 2000);
	});

	onDestroy(() => clearInterval(interval));
</script>

<div class="flex flex-col h-full">
	<PageHeader title="Jobs" description="Running and completed processes">
		{#snippet actions()}
			<Button
				variant="ghost"
				size="sm"
				onclick={() =>
					jobsStore
						.refresh()
						.then(() => (expandedJobId ? loadJobOutput(expandedJobId) : undefined))}
				loading={jobsStore.loading}
			>
				Refresh
			</Button>
			{#if jobsStore.jobs.some((j) => j.status.type !== 'running')}
				<Button variant="ghost" size="sm" onclick={() => jobsStore.clearDone()}>Clear done</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<div class="flex-1 overflow-y-auto p-6">
		{#if jobsStore.loading && jobsStore.jobs.length === 0}
			<div class="flex justify-center py-16">
				<Spinner />
			</div>
		{:else if sortedJobs.length === 0}
			<EmptyState
				title="No jobs yet"
				description="Run a tool or spawn a process to see it listed here."
			>
				{#snippet icon()}
					<Icon icon="lucide:radio" width="30" height="30" class="shrink-0" />
				{/snippet}
			</EmptyState>
		{:else}
			<div class="space-y-2">
				{#each sortedJobs as job (job.id)}
					{@const variant = jobStatusVariant(job)}
					<Card class="overflow-hidden">
						<div
							class="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-2)] transition-colors"
						>
							<button
								class="flex flex-1 items-center gap-3 min-w-0 text-left cursor-pointer"
								onclick={() => toggleExpand(job.id)}
							>
								<Badge {variant} pulse={variant === 'running'}>{jobStatusLabel(job)}</Badge>

								<div class="flex-1 min-w-0">
									<p class="text-sm font-medium text-zinc-800 truncate">
										{jobTitle(job)}
									</p>
									<p class="text-xs font-mono text-zinc-500 truncate mt-0.5">
										{jobSubtitle(job)}
									</p>
									<p class="text-xs text-zinc-600 mt-0.5">
										Started {fmtTime(job.startedAtMs)}
									</p>
								</div>

								<span class="text-xs text-zinc-500 shrink-0 font-mono">
									{fmtDuration(job.startedAtMs, job.endedAtMs ?? undefined)}
								</span>

								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									class="shrink-0 text-zinc-400 transition-transform duration-150 {expandedJobId ===
									job.id
										? 'rotate-180'
										: ''}"
								>
									<path d="M6 9l6 6 6-6" />
								</svg>
							</button>

							{#if variant === 'running'}
								<Button variant="danger" size="sm" onclick={() => jobsStore.kill(job.id)}>
									Kill
								</Button>
							{/if}
						</div>

						{#if expandedJobId === job.id}
							{@const buffered = jobOutputs[job.id]}
							<div
								class="border-t border-[var(--color-border)] px-4 py-3 bg-[var(--color-surface-2)]"
							>
								<dl class="grid grid-cols-3 gap-y-2 text-xs">
									<div>
										<dt class="text-zinc-400">Job ID</dt>
										<dd class="font-mono text-zinc-700 truncate" data-selectable>{job.id}</dd>
									</div>
									<div>
										<dt class="text-zinc-400">Command</dt>
										<dd class="font-mono text-zinc-700" data-selectable>{job.cmd}</dd>
									</div>
									<div>
										<dt class="text-zinc-400">Duration</dt>
										<dd class="text-zinc-700">
											{fmtDuration(job.startedAtMs, job.endedAtMs ?? undefined)}
										</dd>
									</div>
									{#if job.kind}
										<div>
											<dt class="text-zinc-400">Kind</dt>
											<dd class="font-mono text-zinc-700" data-selectable>{job.kind}</dd>
										</div>
									{/if}
									{#if job.label}
										<div class="col-span-2">
											<dt class="text-zinc-400">Label</dt>
											<dd class="text-zinc-700" data-selectable>{job.label}</dd>
										</div>
									{/if}
									{#if job.args.length}
										<div class="col-span-3">
											<dt class="text-zinc-400 mb-0.5">Arguments</dt>
											<dd class="font-mono text-zinc-700 break-all" data-selectable>
												{job.args.join(' ')}
											</dd>
										</div>
									{/if}
								</dl>

								{#if job.metadata}
									<div class="mt-3">
										<p
											class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400"
										>
											Metadata
										</p>
										<pre
											class="max-h-28 overflow-auto rounded-md border border-border bg-white px-2 py-1.5 text-[11px] font-mono text-zinc-600"
											data-selectable>{JSON.stringify(job.metadata, null, 2)}</pre>
									</div>
								{/if}

								<div class="mt-4 border-t border-border pt-3">
									<div class="mb-2 flex items-center justify-between gap-3">
										<p class="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
											Buffered output
											{#if buffered}
												<span class="ml-1 font-normal normal-case tracking-normal text-zinc-400">
													stdout {buffered.stdoutTotal} · stderr {buffered.stderrTotal}
												</span>
											{/if}
										</p>
										<Button
											variant="ghost"
											size="sm"
											onclick={() => loadJobOutput(job.id)}
											loading={!!outputLoading[job.id]}
										>
											Refresh output
										</Button>
									</div>

									{#if outputLoading[job.id] && !buffered}
										<div class="flex items-center gap-2 text-xs text-zinc-400">
											<Spinner class="text-zinc-300" />
											Loading output...
										</div>
									{:else if !buffered || (buffered.stdoutTotal === 0 && buffered.stderrTotal === 0)}
										<p
											class="rounded-lg border border-border bg-white px-3 py-2 text-xs text-zinc-400"
										>
											No buffered stdout or stderr is available for this job.
										</p>
									{:else}
										<div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
											<div>
												<p
													class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400"
												>
													stdout
												</p>
												<div
													class="max-h-64 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-relaxed"
													data-selectable
												>
													{#each terminalLines(buffered.stdout) as line}
														<p class={terminalLineClass(line)}>{line || ' '}</p>
													{/each}
												</div>
											</div>
											<div>
												<p
													class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400"
												>
													stderr
												</p>
												<div
													class="max-h-64 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-relaxed"
													data-selectable
												>
													{#each terminalLines(buffered.stderr) as line}
														<p class={terminalLineClass(line)}>{line || ' '}</p>
													{/each}
												</div>
											</div>
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</Card>
				{/each}
			</div>
		{/if}
	</div>
</div>
