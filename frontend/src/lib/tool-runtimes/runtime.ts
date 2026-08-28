import { liatir } from '$lib/api';
import { runtimeBoxActivationFromMetadata } from '$lib/ai/runtime-box-provenance';
import { throwIfRunCancelled } from '$lib/pipeline/cancellation';
import { waitForJobSettlement } from '$lib/pipeline/job-settlement';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import {
  runtimeIdForToolRuntime,
  type JsonValue,
  type LiatirRuntimeComponentPythonRunResult,
  type LiatirToolRuntimeRecord,
} from '@liatir/core';

export interface ToolRuntimePythonRunOptions {
  args?: string[];
  timeoutSeconds?: number;
  trackJob?: boolean;
  jobLabel?: string;
  metadata?: Record<string, JsonValue>;
  signal?: AbortSignal;
  onJobId?: (jobId: string) => void;
}

/** Executes only inside an activated signed Tool Runtime and keeps long work in Jobs. */
export async function runToolRuntimePython(
  runtime: LiatirToolRuntimeRecord,
  script: string,
  inputJson: Record<string, JsonValue>,
  options: ToolRuntimePythonRunOptions = {},
): Promise<LiatirRuntimeComponentPythonRunResult> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  if (runtime.status !== 'installed') throw new Error(`Tool Runtime is not installed: ${runtime.name}`);
  const runtimeId = runtimeIdForToolRuntime(runtime);
  throwIfRunCancelled(options.signal);

  if (options.trackJob === false) {
    return api.runtimeBoxes.runPython({
      componentKind: 'tool-runtime',
      runtimeId,
      script,
      args: options.args,
      inputJson,
      timeoutSeconds: options.timeoutSeconds,
    });
  }

  const startedAt = Date.now();
  const { jobId } = await api.runtimeBoxes.spawnPython({
    componentKind: 'tool-runtime',
    runtimeId,
    script,
    args: options.args,
    inputJson,
    workspaceId: workspaceStore.activeId,
    label: options.jobLabel ?? runtime.name,
    metadata: {
      toolRuntimeId: runtime.id,
      toolRuntimeName: runtime.name,
      ...(options.metadata ?? {}),
    },
  });
  options.onJobId?.(jobId);
  const timeoutMs = (options.timeoutSeconds ?? 3600) * 1000;
  const settlement = await waitForJobSettlement(api, jobId, {
    signal: options.signal,
    timeoutMs,
    pollIntervalMs: 200,
  });
  if (settlement.timedOut) {
    return {
      ok: false,
      exitCode: null,
      stdout: settlement.stdout.join('\n'),
      stderr: [
        settlement.stderr.join('\n'),
        `Tool Runtime timed out after ${Math.round(timeoutMs / 1000)} seconds`,
      ].filter(Boolean).join('\n'),
      durationMs: Date.now() - startedAt,
    };
  }

  const exitCode = settlement.entry.status.type === 'done' || settlement.entry.status.type === 'failed'
    ? settlement.entry.status.exitCode ?? null
    : null;
  return {
    ok: settlement.entry.status.type === 'done' && (exitCode === null || exitCode === 0),
    exitCode,
    stdout: settlement.stdout.join('\n'),
    stderr: settlement.stderr.join('\n'),
    durationMs: Date.now() - startedAt,
    runtimeBoxActivation: runtimeBoxActivationFromMetadata(settlement.entry.metadata) ?? undefined,
  };
}
