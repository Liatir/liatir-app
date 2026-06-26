import { liatir } from '$lib/api';

/**
 * Execute a .lia module (Node OR WASM runtime) and collect its result.
 *
 * Single source of truth for module execution, shared by the standalone runner
 * page and the pipeline engine. `lia_liatir_run` instruments the runtime:
 *  - Node  → returns `{ jobId }`; we stream `jobs:stdout/stderr/exit` events and
 *            parse the `__LIATIR_RESULT__` marker line for the structured result.
 *  - WASM  → returns the sandboxed result directly (`{ ok, value, stdout, … }`).
 */
export async function runLiatirModule(
  mod: { path: string; runtime: 'node' | 'wasm' },
  inputs: Record<string, unknown>,
  onLog?: (stream: 'stdout' | 'stderr', line: string) => void,
): Promise<{ result: unknown; stdout: string[]; stderr: string[]; exitCode: number | null }> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');

  const stdout: string[] = [];
  const stderr: string[] = [];
  let result: unknown = null;
  let exitCode: number | null = null;

  const res = (await api.invoke('lia_liatir_run', { path: mod.path, inputs })) as
    | { jobId: string }
    | { ok: boolean; value?: unknown; stdout?: string; stderr?: string; error?: string };

  if ('jobId' in res && res.jobId) {
    // ── Node runtime: stream the job until exit ──────────────────────────────
    const jobId = res.jobId;
    await new Promise<void>((resolve) => {
      const unsubs: Array<() => void> = [];

      api.desktop.events.on(`jobs:stdout:${jobId}`, (line: string) => {
        if (line.startsWith('__LIATIR_RESULT__')) {
          try { result = JSON.parse(line.slice('__LIATIR_RESULT__'.length)); } catch { /* ok */ }
        } else {
          stdout.push(line);
          onLog?.('stdout', line);
        }
      }).then((fn: () => void) => unsubs.push(fn));

      api.desktop.events.on(`jobs:stderr:${jobId}`, (line: string) => {
        stderr.push(line);
        onLog?.('stderr', line);
      }).then((fn: () => void) => unsubs.push(fn));

      api.desktop.events.on(`jobs:exit:${jobId}`, (payload: { exitCode: number | null }) => {
        exitCode = payload.exitCode;
        for (const fn of unsubs) fn();
        resolve();
      }).then((fn: () => void) => unsubs.push(fn));
    });
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
