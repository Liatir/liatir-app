import { liatir } from '$lib/api';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import {
  liatirExecutionMetadata,
  type JsonValue,
  type LiatirExecutionIdentity,
} from '@liatir/core';
import { throwIfRunCancelled } from '$lib/pipeline/cancellation';
import { waitForJobSettlement } from '$lib/pipeline/job-settlement';
import { executionRuns } from '$lib/stores/executionRuns.svelte';

export interface NativeRunResult {
  jobId: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  ok: boolean;
}

export interface NativeRunOptions {
  env?: Record<string, string>;
  label?: string;
  kind?: string;
  metadata?: Record<string, JsonValue>;
  onSpawn?: (jobId: string) => void;
  signal?: AbortSignal;
  stdoutPath?: string;
  /** Stable owner copied into the Job and durable execution record. */
  execution?: LiatirExecutionIdentity;
}

/**
 * Spawn a system command via the Rust job registry and poll its buffered
 * stdout/stderr until the process reaches a terminal status.
 *
 * Polling the registry is deliberate: short-lived bio tools can finish before
 * the webview has registered Tauri event listeners, while the backend buffers
 * every output line and final status as the durable source of truth.
 */
export async function runNativeTool(
  cmd: string,
  args: string[],
  onStdout?: (line: string) => void,
  onStderr?: (line: string) => void,
  options: NativeRunOptions = {},
): Promise<NativeRunResult> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  const signal = options.signal ?? (
    options.execution ? executionRuns.signal(options.execution.runId) : undefined
  );
  throwIfRunCancelled(signal);

  const executionMetadata = options.execution
    ? liatirExecutionMetadata(options.execution)
    : {};
  const metadata = {
    ...options.metadata,
    ...executionMetadata,
  };

  // Spawn via invoke directly so the job is tagged with the active workspace.
  // The backend resolves managed native tools to their installed binary (single
  // source of truth, shared with plugins); bare names fall through to PATH.
  const { jobId } = await api.invoke('lia_jobs_spawn', {
    cmd,
    args,
    workspaceId: workspaceStore.activeId,
    env: options.env,
    label: options.label,
    kind: options.kind,
    metadata,
    stdoutPath: options.stdoutPath,
  }) as { jobId: string };
  if (options.execution && executionRuns.byId(options.execution.runId)) {
    await executionRuns.attachJob(options.execution.runId, jobId);
  }
  options.onSpawn?.(jobId);
  const settlement = await waitForJobSettlement(api, jobId, {
    signal,
    onStdout: (line) => {
      onStdout?.(line);
      if (options.execution && executionRuns.byId(options.execution.runId)) {
        void executionRuns.appendLog(options.execution.runId, line, { stream: 'stdout' }).catch(() => {});
      }
    },
    onStderr: (line) => {
      onStderr?.(line);
      if (options.execution && executionRuns.byId(options.execution.runId)) {
        void executionRuns.appendLog(options.execution.runId, line, {
          stream: 'stderr',
          level: 'error',
        }).catch(() => {});
      }
    },
  });
  const exitCode = settlement.entry.status.type === 'done' || settlement.entry.status.type === 'failed'
    ? settlement.entry.status.exitCode ?? null
    : null;
  const completed = settlement.entry.status.type === 'done' && (exitCode === null || exitCode === 0);
  return {
    jobId,
    stdout: settlement.stdout.join('\n'),
    stderr: settlement.stderr.join('\n'),
    exitCode,
    ok: completed,
  };
}
