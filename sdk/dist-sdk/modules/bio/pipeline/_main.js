"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPipeline = buildPipeline;
function buildPipeline(deps) {
    return {
        run: async (steps, opts = {}) => {
            const { continueOnError = false } = opts;
            const results = [];
            const pipelineStart = Date.now();
            let failedAt = null;
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                const stepStart = Date.now();
                let result = {
                    label: step.label,
                    status: "running",
                    durationMs: 0,
                    output: null,
                    error: null,
                };
                try {
                    if (step.kind === "wasm") {
                        const output = await deps.plugins.call(step.module, step.payload, step.timeoutMs);
                        result.output = output;
                        result.status = output.ok ? "done" : "error";
                        if (!output.ok) {
                            result.error = output.error ?? output.stderr ?? "wasm step failed";
                        }
                    }
                    else {
                        const output = await deps.sidecar.run(step.binary, step.args);
                        result.output = output;
                        result.status = output.ok ? "done" : "error";
                        if (!output.ok) {
                            result.error = output.error ?? `exit code ${output.exitCode}`;
                        }
                    }
                }
                catch (err) {
                    result.status = "error";
                    result.error = err instanceof Error ? err.message : String(err);
                }
                result.durationMs = Date.now() - stepStart;
                results.push(result);
                if (result.status === "error") {
                    if (failedAt === null)
                        failedAt = i;
                    if (!continueOnError)
                        break;
                }
            }
            // Mark any steps that were never reached as pending.
            for (let i = results.length; i < steps.length; i++) {
                results.push({
                    label: steps[i].label,
                    status: "pending",
                    durationMs: 0,
                    output: null,
                    error: null,
                });
            }
            return {
                ok: failedAt === null,
                steps: results,
                totalDurationMs: Date.now() - pipelineStart,
                failedAt,
            };
        },
    };
}
