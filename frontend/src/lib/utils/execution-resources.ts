import type { InputFieldSchema } from '$lib/types/pipeline';

export const AUTO_THREADS_VALUE = 0;
export const MAX_AUTO_THREADS = 16;
export const MAX_MANUAL_THREADS = 128;

export function availableLogicalCores(): number {
  const cores = globalThis.navigator?.hardwareConcurrency;
  return Number.isFinite(cores) && cores > 0 ? Math.trunc(cores) : 2;
}

export function autoThreadCount(): number {
  const cores = availableLogicalCores();
  const reserved = cores > 1 ? cores - 1 : 1;
  return Math.max(1, Math.min(MAX_AUTO_THREADS, reserved));
}

export function resolveThreadCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= AUTO_THREADS_VALUE) return autoThreadCount();
  return Math.max(1, Math.min(MAX_MANUAL_THREADS, Math.trunc(parsed)));
}

export function threadParam(value: unknown): { threads: number; mode: 'auto' | 'manual' } {
  const parsed = typeof value === 'number' ? value : Number(value);
  return {
    threads: resolveThreadCount(value),
    mode: Number.isFinite(parsed) && parsed > AUTO_THREADS_VALUE ? 'manual' : 'auto',
  };
}

export function threadInputSchema(description?: string): InputFieldSchema {
  return {
    type: 'number',
    label: 'Threads',
    required: false,
    default: AUTO_THREADS_VALUE,
    description: description ?? '0 lets Liatir choose a safe local thread count.',
  };
}

export function formatThreadFlag(value: unknown): string {
  const { threads, mode } = threadParam(value);
  return mode === 'auto' ? `${threads} auto` : String(threads);
}
