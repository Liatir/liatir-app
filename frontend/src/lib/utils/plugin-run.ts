import { liatir } from '$lib/api';
import type { PluginRuntime } from '$lib/stores/lia-plugins.svelte';
import type { JsonValue } from '@liatir/core';
import { throwIfRunCancelled } from '$lib/pipeline/cancellation';
import { waitForJobSettlement } from '$lib/pipeline/job-settlement';

export interface PluginRunOptions {
  workspaceId?: string | null;
  label?: string;
  kind?: string;
  metadata?: Record<string, JsonValue>;
  onSpawn?: (jobId: string) => void;
  signal?: AbortSignal;
}

/**
 * Execute a .lia plugin (Node, Python, or WASM runtime) and collect its result.
 *
 * Single source of truth for plugin execution, shared by the standalone runner
 * page and the pipeline engine. `lia_liatir_run` instruments the runtime:
 *  - Node/Python → return `{ jobId }`; buffered output is polled until exit and
 *                  the runner marker is parsed for the structured result.
 *  - WASM        → returns the sandboxed result directly (`{ ok, value, stdout, … }`).
 */
export async function runLiatirPlugin(
  plugin: { path: string; runtime: PluginRuntime },
  inputs: Record<string, unknown>,
  onLog?: (stream: 'stdout' | 'stderr', line: string) => void,
  options: PluginRunOptions = {},
): Promise<{ result: unknown; stdout: string[]; stderr: string[]; exitCode: number }> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  throwIfRunCancelled(options.signal);

  const stdout: string[] = [];
  const stderr: string[] = [];
  let result: unknown = null;
  let exitCode = 0;

  const res = (await api.invoke('lia_liatir_run', {
    path: plugin.path,
    inputs,
    workspaceId: options.workspaceId,
    jobLabel: options.label,
    jobKind: options.kind,
    metadata: options.metadata,
  })) as
    | { jobId: string }
    | { ok: boolean; value?: unknown; stdout?: string; stderr?: string; error?: string };

  if ('jobId' in res && res.jobId) {
    // ── Node runtime: poll buffered job output until exit ────────────────────
    // Do not rely only on Tauri events here: very small plugins can print their
    // result and exit before the frontend has registered listeners.
    const jobId = res.jobId;
    options.onSpawn?.(jobId);
    const settlement = await waitForJobSettlement(api, jobId, {
      signal: options.signal,
      onStdout: (line) => {
        if (line.startsWith('__LIATIR_RESULT__')) {
          try { result = JSON.parse(line.slice('__LIATIR_RESULT__'.length)); } catch { /* ignore malformed marker */ }
        } else {
          stdout.push(line);
          onLog?.('stdout', line);
        }
      },
      onStderr: (line) => {
        stderr.push(line);
        onLog?.('stderr', line);
      },
    });
    exitCode = settlement.entry.status.type === 'done'
      ? (settlement.entry.status.exitCode ?? 0)
      : (settlement.entry.status.type === 'failed' ? settlement.entry.status.exitCode ?? 1 : 1);
  } else {
    // ── WASM runtime: the sandboxed plugin returned its result synchronously ──
    const r = res as { ok: boolean; value?: unknown; stdout?: string; stderr?: string; error?: string };
    if (r.value !== undefined && r.value !== null) result = r.value;
    for (const l of (r.stdout ?? '').split('\n')) if (l) { stdout.push(l); onLog?.('stdout', l); }
    for (const l of (r.stderr ?? '').split('\n')) if (l) { stderr.push(l); onLog?.('stderr', l); }
    if (r.error) { stderr.push(r.error); onLog?.('stderr', r.error); }
    exitCode = r.ok ? 0 : 1;
    throwIfRunCancelled(options.signal);
  }

  return { result, stdout, stderr, exitCode };
}
