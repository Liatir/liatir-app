import { offlab } from '$lib/api';

export interface NativeRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  ok: boolean;
}

/**
 * Spawns a system command via Offlab.jobs.spawn, collects all stdout/stderr,
 * and resolves when the process exits. Works with any PATH-installed binary.
 */
export async function runNativeTool(
  cmd: string,
  args: string[],
  onStdout?: (line: string) => void,
): Promise<NativeRunResult> {
  const api = offlab();
  if (!api) throw new Error('Offlab API not available');

  const { jobId } = await api.jobs.spawn(cmd, args);

  return new Promise((resolve) => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const unlisteners: Array<() => void> = [];

    const cleanup = () => {
      for (const fn of unlisteners) fn();
    };

    api.desktop.events.on(`jobs:stdout:${jobId}`, (line: string) => {
      stdoutLines.push(line);
      onStdout?.(line);
    }).then((fn: () => void) => unlisteners.push(fn));

    api.desktop.events.on(`jobs:stderr:${jobId}`, (line: string) => {
      stderrLines.push(line);
    }).then((fn: () => void) => unlisteners.push(fn));

    api.desktop.events.on(`jobs:exit:${jobId}`, (payload: { exitCode: number | null; ok: boolean }) => {
      cleanup();
      resolve({
        stdout: stdoutLines.join('\n'),
        stderr: stderrLines.join('\n'),
        exitCode: payload.exitCode,
        ok: payload.ok,
      });
    }).then((fn: () => void) => unlisteners.push(fn));
  });
}
