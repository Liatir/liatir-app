import { liatir } from '$lib/api';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import type { JsonValue } from '@liatir/core';
import { RunCancelledError, throwIfRunCancelled } from '$lib/pipeline/cancellation';

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
  throwIfRunCancelled(options.signal);

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
    metadata: options.metadata,
    stdoutPath: options.stdoutPath,
  }) as { jobId: string };
  options.onSpawn?.(jobId);
  const cancelJob = () => {
    void api.invoke('lia_jobs_kill', { jobId }).catch(() => {});
  };
  options.signal?.addEventListener('abort', cancelJob, { once: true });

  try {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    let stdoutSeen = 0;
    let stderrSeen = 0;

    while (true) {
      if (options.signal?.aborted) {
        cancelJob();
        throw new RunCancelledError();
      }
    const since = Math.min(stdoutSeen, stderrSeen);
    const [out, entry] = await Promise.all([
      api.invoke('lia_jobs_get_output', { jobId, since }) as Promise<{
        stdout: string[];
        stderr: string[];
        stdoutTotal: number;
        stderrTotal: number;
      }>,
      api.invoke('lia_jobs_status', { jobId }) as Promise<{
        status: { type: 'running' | 'done' | 'failed' | 'killed'; exitCode?: number | null };
      }>,
    ]);

    const stdoutStart = Math.max(0, stdoutSeen - since);
    const stderrStart = Math.max(0, stderrSeen - since);

    for (const line of out.stdout.slice(stdoutStart)) {
      stdoutLines.push(line);
      onStdout?.(line);
    }
    for (const line of out.stderr.slice(stderrStart)) {
      stderrLines.push(line);
      onStderr?.(line);
    }

    stdoutSeen = out.stdoutTotal;
    stderrSeen = out.stderrTotal;

    if (entry.status.type !== 'running') {
      const exitCode = entry.status.type === 'done' || entry.status.type === 'failed'
        ? entry.status.exitCode ?? null
        : null;
      const completed = entry.status.type === 'done' && (exitCode === null || exitCode === 0);
      return {
        jobId,
        stdout: stdoutLines.join('\n'),
        stderr: stderrLines.join('\n'),
        exitCode,
        ok: completed,
      };
    }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    options.signal?.removeEventListener('abort', cancelJob);
  }
}
