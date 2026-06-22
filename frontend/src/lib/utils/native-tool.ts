import { liatir } from '$lib/api';
import { getManagedBinPath } from '$lib/tools/binary-manager';
import { workspaceStore } from '$lib/stores/workspace.svelte';

export interface NativeRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  ok: boolean;
}

/**
 * Spawns a system command via Liatir.jobs.spawn, streams stdout/stderr via callbacks,
 * and resolves when the process exits.
 *
 * All three event listeners are registered atomically (via Promise.all) before any
 * can fire, avoiding the race condition where early events are lost.
 */
export async function runNativeTool(
  cmd: string,
  args: string[],
  onStdout?: (line: string) => void,
  onStderr?: (line: string) => void,
): Promise<NativeRunResult> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');

  const managedPath = getManagedBinPath(cmd);
  // Spawn via invoke directly so the job is tagged with the active workspace.
  const { jobId } = await api.invoke('lia_jobs_spawn', {
    cmd: managedPath ?? cmd,
    args,
    workspaceId: workspaceStore.activeId,
  }) as { jobId: string };

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  // Declare unlisten refs so exit callback can call them
  let offStdout: (() => void) | undefined;
  let offStderr: (() => void) | undefined;
  let offExit: (() => void) | undefined;

  return new Promise<NativeRunResult>((outerResolve, outerReject) => {
    // async IIFE inside the Promise so we can await Promise.all
    (async () => {
      try {
        // Register all three listeners simultaneously — avoids race where early
        // events are lost while waiting for sequential listener registrations.
        [offStdout, offStderr, offExit] = await Promise.all([
          api.desktop.events.on(`jobs:stdout:${jobId}`, (line: string) => {
            stdoutLines.push(line);
            onStdout?.(line);
          }),
          api.desktop.events.on(`jobs:stderr:${jobId}`, (line: string) => {
            stderrLines.push(line);
            onStderr?.(line);
          }),
          api.desktop.events.on(`jobs:exit:${jobId}`, (payload: { exitCode: number | null; ok: boolean }) => {
            offStdout?.();
            offStderr?.();
            offExit?.();
            outerResolve({
              stdout: stdoutLines.join('\n'),
              stderr: stderrLines.join('\n'),
              exitCode: payload.exitCode,
              ok: payload.ok,
            });
          }),
        ]);
      } catch (err) {
        outerReject(err);
      }
    })();
  });
}
