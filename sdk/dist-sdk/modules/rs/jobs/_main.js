"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobs = buildJobs;
function buildJobs(core) {
    return {
        spawn: (cmd, args, opts = {}) => core.invoke("lia_jobs_spawn", {
            cmd,
            args,
            cwd: opts.cwd,
            env: opts.env,
            label: opts.label,
            kind: opts.kind,
            metadata: opts.metadata,
        }),
        kill: (jobId) => core.invoke("lia_jobs_kill", { jobId }),
        status: (jobId) => core.invoke("lia_jobs_status", { jobId }),
        list: () => core.invoke("lia_jobs_list"),
        clearDone: () => core.invoke("lia_jobs_clear_done"),
    };
}
