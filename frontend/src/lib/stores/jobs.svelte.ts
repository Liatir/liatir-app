import { offlab } from '$lib/api';

export type JobStatus = 'Running' | { Done: { exit_code: number | null } } | { Failed: { exit_code: number | null } } | 'Killed';

export interface JobEntry {
  id: string;
  cmd: string;
  args: string[];
  status: JobStatus;
  started_at_ms: number;
  ended_at_ms: number | null;
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
      return jobs.filter((j) => j.status === 'Running').length;
    },

    async refresh() {
      const api = offlab();
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
      const api = offlab();
      if (!api) return null;
      const result = await api.jobs.spawn(cmd, args, cwd ? { cwd } : undefined);
      await this.refresh();
      return result as { jobId: string };
    },

    async kill(jobId: string) {
      const api = offlab();
      if (!api) return;
      await api.jobs.kill(jobId);
      await this.refresh();
    },

    async clearDone() {
      const api = offlab();
      if (!api) return;
      await api.jobs.clearDone();
      await this.refresh();
    },
  };
}

export const jobsStore = createJobsStore();
