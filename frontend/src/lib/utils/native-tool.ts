import { liatir } from '$lib/api';
import { getManagedBinPath } from '$lib/tools/binary-manager';

export interface NativeRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  ok: boolean;
}

/**
 * Spawns a system command via Liatir.jobs.spawn, collects all stdout/stderr,
 * and resolves when the process exits. Works with any PATH-installed binary.
 */
export async function runNativeTool(
  cmd: string,
  args: string[],
  onStdout?: (line: string) => void,
): Promise<NativeRunResult> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');

  // Prefer a managed (downloaded) binary over the system PATH binary
  const managedPath = getManagedBinPath(cmd);
  const { jobId } = await api.jobs.spawn(managedPath ?? cmd, args);

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
