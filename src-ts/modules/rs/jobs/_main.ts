import { LiatirAPI } from "../../../types";
import { JobEntry, JobsInterface, SpawnOptions, SpawnResult } from "./_types";

export function buildJobs(core: { invoke: LiatirAPI["invoke"] }): JobsInterface {
  return {
    spawn: (cmd: string, args: string[], opts: SpawnOptions = {}): Promise<SpawnResult> =>
      core.invoke("lia_jobs_spawn", { cmd, args, cwd: opts.cwd }),

    kill: (jobId: string): Promise<boolean> =>
      core.invoke("lia_jobs_kill", { jobId }),

    status: (jobId: string): Promise<JobEntry> =>
      core.invoke("lia_jobs_status", { jobId }),

    list: (): Promise<JobEntry[]> =>
      core.invoke("lia_jobs_list"),

    clearDone: (): Promise<number> =>
      core.invoke("lia_jobs_clear_done"),
  };
}
