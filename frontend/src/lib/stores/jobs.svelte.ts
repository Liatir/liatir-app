import { liatir } from '$lib/api';
import { workspaceStore } from './workspace.svelte';
import { executionRuns } from './executionRuns.svelte';
import type {
	LiatirJobEntry,
	LiatirJobProgress,
	LiatirJobStatus,
} from '@liatir/core';

export type JobStatus = LiatirJobStatus;
export type JobProgress = LiatirJobProgress;

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface PluginLogEntry {
	jobId: string;
	level: LogLevel;
	message: string;
	meta?: Record<string, unknown> | null;
	timestampMs: number;
}

export type JobEntry = LiatirJobEntry;

export interface JobBufferedOutput {
	stdout: string[];
	stderr: string[];
	stdoutTotal: number;
	stderrTotal: number;
}

function executionRunId(job: Pick<JobEntry, 'metadata'> | undefined): string | null {
	const execution = job?.metadata?.execution;
	if (!execution || typeof execution !== 'object' || Array.isArray(execution)) return null;
	const runId = (execution as Record<string, unknown>).runId;
	return typeof runId === 'string' ? runId : null;
}

function createJobsStore() {
	let jobs = $state<JobEntry[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Per-job log entries and progress — keyed by jobId
	let jobLogs = $state<Map<string, PluginLogEntry[]>>(new Map());
	let jobProgress = $state<Map<string, JobProgress>>(new Map());

	// Active event listeners — cleaned up when job finishes
	const logUnlisteners: Map<string, () => void> = new Map();
	const progressUnlisteners: Map<string, () => void> = new Map();

	/**
	 * Subscribe to log and progress events for a specific job.
	 * Call this after spawning a job to receive real-time updates.
	 */
	async function subscribeToJob(jobId: string): Promise<void> {
		const api = liatir();
		if (!api) return;

		// Avoid duplicate subscriptions
		if (logUnlisteners.has(jobId)) return;

		// Log events
		const logUnlisten = await api.desktop.events.on(
			`jobs:log:${jobId}`,
			(raw: unknown) => {
				const entry = raw as PluginLogEntry;
				const existing = jobLogs.get(jobId) ?? [];
				jobLogs = new Map(jobLogs).set(jobId, [...existing, entry]);
				const runId = executionRunId(jobs.find((job) => job.id === jobId));
				if (runId && executionRuns.byId(runId)) {
					void executionRuns.appendLog(runId, entry.message, {
						level: entry.level,
						stream: entry.level === 'error' ? 'stderr' : 'system',
						timestampMs: entry.timestampMs,
					}).catch(() => {});
				}
			}
		) as unknown as () => void;
		logUnlisteners.set(jobId, logUnlisten);

		// Progress events
		const progressUnlisten = await api.desktop.events.on(
			`jobs:progress:${jobId}`,
			(raw: unknown) => {
				const progress = raw as JobProgress;
				jobProgress = new Map(jobProgress).set(jobId, progress);
				const runId = executionRunId(jobs.find((job) => job.id === jobId));
				if (runId && executionRuns.byId(runId)) {
					void executionRuns.setProgress(runId, progress).catch(() => {});
				}

				// Also update the job entry's progress field
				const jobIndex = jobs.findIndex((j) => j.id === jobId);
				if (jobIndex >= 0) {
					const updated = [...jobs];
					updated[jobIndex] = { ...updated[jobIndex], progress };
					jobs = updated;
				}

				// Auto-cleanup when done
				if (progress.done) {
					cleanupJobListeners(jobId);
				}
			}
		) as unknown as () => void;
		progressUnlisteners.set(jobId, progressUnlisten);
	}

	function cleanupJobListeners(jobId: string) {
		const logUnlisten = logUnlisteners.get(jobId);
		if (logUnlisten) {
			logUnlisten();
			logUnlisteners.delete(jobId);
		}
		const progressUnlisten = progressUnlisteners.get(jobId);
		if (progressUnlisten) {
			progressUnlisten();
			progressUnlisteners.delete(jobId);
		}
	}

	return {
		get jobs() {
			return jobs;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},

		get runningCount() {
			return jobs.filter((j) => j.status.type === 'running').length;
		},

		/** Get log entries for a specific job. */
		getLogs(jobId: string): PluginLogEntry[] {
			return jobLogs.get(jobId) ?? [];
		},

		/** Get progress for a specific job — live events first, else the last value on the job entry. */
		getProgress(jobId: string): JobProgress | null {
			return jobProgress.get(jobId) ?? jobs.find((j) => j.id === jobId)?.progress ?? null;
		},

		/** Subscribe to real-time log and progress events for a job. */
		subscribeToJob,

		async refresh() {
			const api = liatir();
			if (!api) return;
			loading = true;
			error = null;
			try {
				// Scope the list to the active workspace so jobs don't leak across them.
				jobs = (await api.invoke('lia_jobs_list', {
					workspaceId: workspaceStore.activeId
				})) as JobEntry[];
				// Subscribe to still-running jobs (e.g. after a reload, or ones spawned by a
				// plugin elsewhere) so their live log/progress events are captured too.
				// subscribeToJob() de-dupes, so re-subscribing an already-tracked job is cheap.
				for (const job of jobs) {
					const runId = executionRunId(job);
					if (runId && executionRuns.byId(runId)) {
						void executionRuns.attachJob(runId, job.id).catch(() => {});
						if (job.progress) void executionRuns.setProgress(runId, job.progress).catch(() => {});
					}
					if (job.status.type === 'running') void subscribeToJob(job.id);
				}
			} catch (e) {
				error = String(e);
			} finally {
				loading = false;
			}
		},

		async spawn(
			cmd: string,
			args: string[],
			cwd?: string,
			options: {
				env?: Record<string, string>;
				label?: string;
				kind?: string;
				metadata?: Record<string, unknown>;
			} = {}
		) {
			const api = liatir();
			if (!api) return null;
			const result = (await api.invoke('lia_jobs_spawn', {
				cmd,
				args,
				cwd,
				workspaceId: workspaceStore.activeId,
				env: options.env,
				label: options.label,
				kind: options.kind,
				metadata: options.metadata
			})) as { jobId: string };
			await this.refresh();
			// Auto-subscribe to events for the new job
			await subscribeToJob(result.jobId);
			return result;
		},

		async beginLogical(
			name: string,
			options: { label?: string; kind?: string; metadata?: Record<string, unknown> } = {},
		): Promise<{ jobId: string } | null> {
			const api = liatir();
			if (!api) return null;
			const result = await api.invoke('lia_jobs_begin_logical', {
				name,
				workspaceId: workspaceStore.activeId,
				...options,
			}) as { jobId: string };
			await this.refresh();
			await subscribeToJob(result.jobId);
			return result;
		},

		async appendLogicalOutput(jobId: string, stream: 'stdout' | 'stderr', line: string): Promise<void> {
			const api = liatir();
			if (!api) return;
			await api.invoke('lia_jobs_append_logical_output', { jobId, stream, line });
		},

		async setProgress(jobId: string, progress: JobProgress): Promise<void> {
			const api = liatir();
			if (!api) return;
			await api.invoke('lia_plugin_progress', {
				jobId,
				current: progress.current,
				total: progress.total ?? null,
				label: progress.label ?? null,
				delta: null,
				done: progress.done,
			});
		},

		async finishLogical(jobId: string, ok: boolean): Promise<void> {
			const api = liatir();
			if (!api) return;
			await api.invoke('lia_jobs_finish_logical', { jobId, ok });
			await this.refresh();
		},

		async kill(jobId: string) {
			const api = liatir();
			if (!api) return;
			const runId = executionRunId(jobs.find((job) => job.id === jobId));
			if (runId && executionRuns.byId(runId)) {
				await executionRuns.cancel(runId);
			} else {
				await api.invoke('lia_jobs_kill', { jobId });
			}
			cleanupJobListeners(jobId);
			await this.refresh();
		},

		async clearDone() {
			const api = liatir();
			if (!api) return;
			await api.invoke('lia_jobs_clear_done', { workspaceId: workspaceStore.activeId });
			await this.refresh();
		},

		async getOutput(jobId: string, since?: number): Promise<JobBufferedOutput | null> {
			const api = liatir();
			if (!api) return null;
			return (await api.invoke('lia_jobs_get_output', {
				jobId,
				since: since ?? null
			})) as JobBufferedOutput;
		}
	};
}

export const jobsStore = createJobsStore();
