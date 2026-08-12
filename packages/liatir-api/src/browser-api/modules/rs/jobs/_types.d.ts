import type { LiatirJobEntry, LiatirJobProgress, LiatirJobStatus } from "@liatir/core";
export type JobStatus = LiatirJobStatus;
export type JobEntry = LiatirJobEntry;
export type SpawnResult = {
    jobId: string;
};
export type LogicalJobOptions = Pick<SpawnOptions, "label" | "kind" | "metadata">;
export type SpawnOptions = {
    /** Working directory for the spawned process */
    cwd?: string;
    /** Environment variables added or overridden for the spawned process. */
    env?: Record<string, string>;
    /** Human-readable label shown in job lists. */
    label?: string;
    /** Stable machine-readable job category. */
    kind?: string;
    /** Small structured metadata for UI routing and diagnostics. */
    metadata?: Record<string, unknown>;
};
export interface JobsInterface {
    /**
     * Spawn an async process. Returns immediately with a jobId.
     * Subscribe to events via Liatir.desktop.events:
     *   "jobs:stdout:<jobId>" → line: string
     *   "jobs:stderr:<jobId>" → line: string
     *   "jobs:exit:<jobId>"   → { jobId, exitCode, ok }
     */
    spawn: (cmd: string, args: string[], opts?: SpawnOptions) => Promise<SpawnResult>;
    /** Track asynchronous work performed inside the app rather than a child process. */
    beginLogical: (name: string, opts?: LogicalJobOptions) => Promise<SpawnResult>;
    appendLogicalOutput: (jobId: string, stream: "stdout" | "stderr", line: string) => Promise<void>;
    setProgress: (jobId: string, progress: LiatirJobProgress) => Promise<void>;
    finishLogical: (jobId: string, ok: boolean) => Promise<void>;
    kill: (jobId: string) => Promise<boolean>;
    status: (jobId: string) => Promise<JobEntry>;
    list: () => Promise<JobEntry[]>;
    /** Remove all completed/failed/killed jobs from the registry */
    clearDone: () => Promise<number>;
}
