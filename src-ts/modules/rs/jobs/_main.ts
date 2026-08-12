/**
 * `Liatir.jobs` — spawning and tracking long-running processes.
 *
 * A job is how anything slow gets run: a native tool, a Python script, a plugin. It is *detached* — `spawn`
 * returns as soon as the process starts, and its output and status arrive later, which is what lets an
 * analysis run for minutes while the user keeps working.
 *
 * `label`, `kind` and `metadata` are what make a job identifiable after the fact. The Jobs list uses them to
 * show what a process is, and `metadata` is where the caller stashes whatever it will need to turn the
 * finished job into a Result (see `direct-run-context` on the frontend side).
 */
import { LiatirAPI } from "../../../types";
import { JobEntry, JobsInterface, LogicalJobOptions, SpawnOptions, SpawnResult } from "./_types";

export function buildJobs(core: { invoke: LiatirAPI["invoke"] }): JobsInterface {
  return {
    spawn: (cmd: string, args: string[], opts: SpawnOptions = {}): Promise<SpawnResult> =>
      core.invoke("lia_jobs_spawn", {
        cmd,
        args,
        cwd: opts.cwd,
        env: opts.env,
        label: opts.label,
        kind: opts.kind,
        metadata: opts.metadata,
      }),

    beginLogical: (name: string, opts: LogicalJobOptions = {}): Promise<SpawnResult> =>
      core.invoke("lia_jobs_begin_logical", {
        name,
        label: opts.label,
        kind: opts.kind,
        metadata: opts.metadata,
      }),

    appendLogicalOutput: (jobId, stream, line): Promise<void> =>
      core.invoke("lia_jobs_append_logical_output", { jobId, stream, line }),

    setProgress: (jobId, progress): Promise<void> =>
      core.invoke("lia_plugin_progress", {
        jobId,
        current: progress.current,
        total: progress.total ?? null,
        label: progress.label ?? null,
        delta: null,
        done: progress.done,
      }),

    finishLogical: (jobId, ok): Promise<void> =>
      core.invoke("lia_jobs_finish_logical", { jobId, ok }),

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
