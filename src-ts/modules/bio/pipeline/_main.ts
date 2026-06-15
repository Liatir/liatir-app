import { PluginsInterface } from "../../rs/plugins/_types";
import { SidecarInterface } from "../../rs/sidecar/_types";
import {
  PipelineInterface,
  PipelineResult,
  PipelineStep,
  StepResult,
} from "./_types";

export function buildPipeline(deps: {
  plugins: PluginsInterface;
  sidecar: SidecarInterface;
}): PipelineInterface {
  return {
    run: async (
      steps: PipelineStep[],
      opts: { continueOnError?: boolean } = {}
    ): Promise<PipelineResult> => {
      const { continueOnError = false } = opts;
      const results: StepResult[] = [];
      const pipelineStart = Date.now();
      let failedAt: number | null = null;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepStart = Date.now();

        let result: StepResult = {
          label: step.label,
          status: "running",
          durationMs: 0,
          output: null,
          error: null,
        };

        try {
          if (step.kind === "wasm") {
            const output = await deps.plugins.call(
              step.module,
              step.payload,
              step.timeoutMs
            );
            result.output = output;
            result.status = output.ok ? "done" : "error";
            if (!output.ok) {
              result.error = output.error ?? output.stderr ?? "wasm step failed";
            }
          } else {
            const output = await deps.sidecar.run(step.binary, step.args);
            result.output = output;
            result.status = output.ok ? "done" : "error";
            if (!output.ok) {
              result.error = output.error ?? `exit code ${output.exitCode}`;
            }
          }
        } catch (err: unknown) {
          result.status = "error";
          result.error = err instanceof Error ? err.message : String(err);
        }

        result.durationMs = Date.now() - stepStart;
        results.push(result);

        if (result.status === "error") {
          if (failedAt === null) failedAt = i;
          if (!continueOnError) break;
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
