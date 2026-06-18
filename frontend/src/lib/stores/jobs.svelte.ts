import { liatir } from '$lib/api';

export type JobStatus =
  | { type: 'running' }
  | { type: 'done'; exitCode: number | null }
  | { type: 'failed'; exitCode: number | null }
  | { type: 'killed' };

export interface JobEntry {
  id: string;
  cmd: string;
  args: string[];
  status: JobStatus;
  startedAtMs: number;
  endedAtMs: number | null;
}

function createJobsStore() {
  let jobs = $state<JobEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  return {
    get jobs() { return jobs; },
    get loading() { return loading; },
    get error() { return error; },

    get runningCount() {
      return jobs.filter((j) => j.status.type === 'running').length;
    },

    async refresh() {
      const api = liatir();
      if (!api) return;
      loading = true;
      error = null;
      try {
        jobs = await api.jobs.list();
      } catch (e) {
        error = String(e);
      } finally {
        loading = false;
      }
    },

    async spawn(cmd: string, args: string[], cwd?: string) {
      const api = liatir();
      if (!api) return null;
      const result = await api.jobs.spawn(cmd, args, cwd ? { cwd } : undefined);
      await this.refresh();
      return result as { jobId: string };
    },

    async kill(jobId: string) {
      const api = liatir();
      if (!api) return;
      await api.jobs.kill(jobId);
      await this.refresh();
    },

    async clearDone() {
      const api = liatir();
      if (!api) return;
      await api.jobs.clearDone();
      await this.refresh();
    },
  };
}

export const jobsStore = createJobsStore();
