export type JobStatus = {
    type: "running";
} | {
    type: "done";
    exitCode: number | null;
} | {
    type: "failed";
    exitCode: number | null;
} | {
    type: "killed";
};
export type JobEntry = {
    id: string;
    cmd: string;
    args: string[];
    status: JobStatus;
    startedAtMs: number;
    endedAtMs: number | null;
};
export type SpawnResult = {
    jobId: string;
};
export type SpawnOptions = {
    /** Working directory for the spawned process */
    cwd?: string;
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
    kill: (jobId: string) => Promise<boolean>;
    status: (jobId: string) => Promise<JobEntry>;
    list: () => Promise<JobEntry[]>;
    /** Remove all completed/failed/killed jobs from the registry */
    clearDone: () => Promise<number>;
}
