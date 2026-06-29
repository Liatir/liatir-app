import { liatir } from '$lib/api';
import { workspaceStore } from './workspace.svelte';

export type JobStatus =
	| { type: 'running' }
	| { type: 'done'; exitCode: number | null }
	| { type: 'failed'; exitCode: number | null }
	| { type: 'killed' };

export interface JobEntry {
	id: string;
	cmd: string;
	args: string[];
	label?: string | null;
	kind?: string | null;
	metadata?: Record<string, unknown> | null;
	status: JobStatus;
	startedAtMs: number;
	endedAtMs: number | null;
	workspaceId?: string | null;
}

export interface JobBufferedOutput {
	stdout: string[];
	stderr: string[];
	stdoutTotal: number;
	stderrTotal: number;
}

function createJobsStore() {
	let jobs = $state<JobEntry[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

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
			return result;
		},

		async kill(jobId: string) {
			const api = liatir();
			if (!api) return;
			await api.invoke('lia_jobs_kill', { jobId });
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
