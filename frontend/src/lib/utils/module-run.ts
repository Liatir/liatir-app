import { liatir } from '$lib/api';

/**
 * Execute a .lia plugin (Node OR WASM runtime) and collect its result.
 *
 * Single source of truth for plugin execution, shared by the standalone runner
 * page and the pipeline engine. `lia_liatir_run` instruments the runtime:
 *  - Node  → returns `{ jobId }`; we stream `jobs:stdout/stderr/exit` events and
 *            parse the `__LIATIR_RESULT__` marker line for the structured result.
 *  - WASM  → returns the sandboxed result directly (`{ ok, value, stdout, … }`).
 */
export async function runLiatirModule(
  mod: { path: string; runtime: 'node' | 'wasm' },
  inputs: Record<string, unknown>,
  onLog?: (stream: 'stdout' | 'stderr', line: string) => void,
): Promise<{ result: unknown; stdout: string[]; stderr: string[]; exitCode: number }> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');

  const stdout: string[] = [];
  const stderr: string[] = [];
  let result: unknown = null;
  let exitCode = 0;

  const res = (await api.invoke('lia_liatir_run', { path: mod.path, inputs })) as
    | { jobId: string }
    | { ok: boolean; value?: unknown; stdout?: string; stderr?: string; error?: string };

  if ('jobId' in res && res.jobId) {
    // ── Node runtime: poll buffered job output until exit ────────────────────
    // Do not rely only on Tauri events here: very small plugins can print their
    // result and exit before the frontend has registered listeners.
    const jobId = res.jobId;
    let stdoutSeen = 0;
    let stderrSeen = 0;

    while (true) {
      const [out, entry] = await Promise.all([
        api.invoke('lia_jobs_get_output', { jobId }) as Promise<{
          stdout: string[];
          stderr: string[];
          stdoutTotal: number;
          stderrTotal: number;
        }>,
        api.invoke('lia_jobs_status', { jobId }) as Promise<{
          status: { type: 'running' | 'done' | 'failed' | 'killed'; exitCode?: number | null };
        }>,
      ]);

      for (const line of out.stdout.slice(stdoutSeen)) {
        if (line.startsWith('__LIATIR_RESULT__')) {
          try { result = JSON.parse(line.slice('__LIATIR_RESULT__'.length)); } catch { /* ignore malformed marker */ }
        } else {
          stdout.push(line);
          onLog?.('stdout', line);
        }
      }
      for (const line of out.stderr.slice(stderrSeen)) {
        stderr.push(line);
        onLog?.('stderr', line);
      }

      stdoutSeen = out.stdoutTotal;
      stderrSeen = out.stderrTotal;

      if (entry.status.type !== 'running') {
        exitCode = entry.status.type === 'done' ? (entry.status.exitCode ?? 0) : (entry.status.exitCode ?? 1);
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } else {
    // ── WASM runtime: the sandboxed module returned its result synchronously ──
    const r = res as { ok: boolean; value?: unknown; stdout?: string; stderr?: string; error?: string };
    if (r.value !== undefined && r.value !== null) result = r.value;
    for (const l of (r.stdout ?? '').split('\n')) if (l) { stdout.push(l); onLog?.('stdout', l); }
    for (const l of (r.stderr ?? '').split('\n')) if (l) { stderr.push(l); onLog?.('stderr', l); }
    if (r.error) { stderr.push(r.error); onLog?.('stderr', r.error); }
    exitCode = r.ok ? 0 : 1;
  }

  return { result, stdout, stderr, exitCode };
}
