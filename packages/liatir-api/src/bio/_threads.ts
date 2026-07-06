/**
 * Resolve a worker-thread count for a bio tool run. A caller-provided positive
 * value wins (clamped to a sane range); otherwise pick a safe local default
 * from the available cores. Shared by every bio namespace — the single source
 * of truth, not copied per tool.
 */
export function resolveThreads(value?: number): number {
  if (Number.isFinite(value) && value! > 0) return Math.max(1, Math.min(128, Math.trunc(value!)));
  const cores = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 2;
  return Math.max(1, Math.min(16, cores > 1 ? cores - 1 : 1));
}
