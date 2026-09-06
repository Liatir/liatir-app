import type { LiatirRuntimeComponentPythonRunResult } from '@liatir/core';
import { runtimeBoxActivationFromMetadata } from '$lib/ai/runtime-box-provenance';
import { finalizeExecutionResult } from '$lib/execution/finalization';
import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
import { jobsStore, type JobBufferedOutput, type JobEntry } from '$lib/stores/jobs.svelte';
import { toolRuntimesStore } from '$lib/stores/toolRuntimes.svelte';
import {
  finalizeNeoantigenPrioritizationResult,
  neoantigenPrioritizationDefinition,
} from '$lib/tools/oncology/neoantigen-prioritization';
import {
  finalizeOpenMMResult,
  molecularDynamicsDefinition,
  molecularRelaxationDefinition,
} from '$lib/tools/molecular-simulation/openmm';
import { parseToolRuntimeDirectRunContext } from './direct-run-context';

const finalizing = new Set<string>();

function exitCode(job: JobEntry): number | null {
  return job.status.type === 'done' || job.status.type === 'failed'
    ? job.status.exitCode ?? null
    : null;
}

function outputToResult(
  job: JobEntry,
  output: JobBufferedOutput,
  startedAt: number,
): LiatirRuntimeComponentPythonRunResult {
  const code = exitCode(job);
  return {
    ok: job.status.type === 'done' && (code === null || code === 0),
    exitCode: code,
    stdout: output.stdout.join('\n'),
    stderr: output.stderr.join('\n'),
    durationMs: (job.endedAtMs ?? Date.now()) - startedAt,
    runtimeBoxActivation: runtimeBoxActivationFromMetadata(job.metadata) ?? undefined,
  };
}

function outputLog(job: JobEntry, output: JobBufferedOutput | null): string[] {
  const lines = [`$ ${[job.cmd, ...job.args].join(' ')}`];
  if (output) lines.push(...output.stderr, ...output.stdout);
  return lines;
}

export function hasRunningDirectToolRuntimeJob(jobs: JobEntry[]): boolean {
  return jobs.some((job) =>
    job.kind === 'tool-runtime-python'
    && job.status.type === 'running'
    && parseToolRuntimeDirectRunContext(job.metadata) !== null
  );
}

/** Finalizes a direct Tool Runtime job after navigation or an app restart. */
export async function finalizeCompletedToolRuntimeDirectRuns(jobs: JobEntry[]): Promise<void> {
  await analysisRuns.init();
  await toolRuntimesStore.init();
  for (const job of jobs) {
    const context = parseToolRuntimeDirectRunContext(job.metadata);
    if (!context || job.kind !== 'tool-runtime-python' || job.status.type === 'running') continue;
    if (analysisRuns.runs.some((run) => run.id === context.analysisRunId)) continue;
    if (finalizing.has(context.analysisRunId)) continue;
    finalizing.add(context.analysisRunId);
    try {
      const output = await jobsStore.getOutput(job.id);
      const logs = outputLog(job, output);
      if (!output) throw new Error(`Buffered output is not available for job ${job.id}.`);
      if (job.status.type === 'killed') throw new Error('Tool Runtime run was killed.');
      const runtimeId = typeof job.metadata?.toolRuntimeId === 'string' ? job.metadata.toolRuntimeId : '';
      const runtime = toolRuntimesStore.runtimes.find((item) => item.id === runtimeId);
      if (!runtime) throw new Error(`Unknown Tool Runtime: ${runtimeId || 'missing metadata'}`);
      const runtimeResult = outputToResult(job, output, context.startedAt);
      const appendLog = (line: string) => { if (line.trim()) logs.push(line); };
      const finalized = context.toolId === neoantigenPrioritizationDefinition.id
        ? await finalizeNeoantigenPrioritizationResult(runtime, context.params, runtimeResult, appendLog)
        : context.toolId === molecularRelaxationDefinition.id
          ? await finalizeOpenMMResult(
              runtime, 'relaxation', context.params, context.outputDir, runtimeResult, appendLog,
            )
          : context.toolId === molecularDynamicsDefinition.id
            ? await finalizeOpenMMResult(
                runtime, 'dynamics', context.params, context.outputDir, runtimeResult, appendLog,
              )
            : null;
      if (!finalized) throw new Error(`Unsupported Tool Runtime finalizer: ${context.toolId}`);
      const endedAt = job.endedAtMs ?? Date.now();
      await finalizeExecutionResult(context.execution.runId, 'done', {
        id: context.analysisRunId,
        tool: context.toolId,
        label: context.label,
        inputs: context.inputPaths,
        inputSizes: context.inputSizes,
        outputFiles: finalized.outputFiles,
        sideEffects: [],
        params: context.params,
        startedAt: context.startedAt,
        endedAt,
        durationMs: endedAt - context.startedAt,
        output: finalized.output,
        error: null,
        log: logs,
      });
    } catch (error) {
      const endedAt = job.endedAtMs ?? Date.now();
      const message = error instanceof Error ? error.message : String(error);
      const output = await jobsStore.getOutput(job.id).catch(() => null);
      const cancelled = job.status.type === 'killed';
      await finalizeExecutionResult(context.execution.runId, cancelled ? 'cancelled' : 'error', {
        id: context.analysisRunId,
        tool: context.toolId,
        label: context.label,
        inputs: context.inputPaths,
        inputSizes: context.inputSizes,
        sideEffects: [],
        params: context.params,
        startedAt: context.startedAt,
        endedAt,
        durationMs: endedAt - context.startedAt,
        output: null,
        error: cancelled ? 'Tool Runtime run was cancelled.' : message,
        log: [...outputLog(job, output), `Error: ${message}`],
      }).catch(() => {});
    } finally {
      finalizing.delete(context.analysisRunId);
    }
  }
}
