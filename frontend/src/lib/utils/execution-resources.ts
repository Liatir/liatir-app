/**
 * Thread-count handling for tool runs, on the frontend side.
 *
 * The same policy as the Rust `execution_resources` module, and deliberately so: leave one core free
 * so the machine stays usable while a long analysis runs. This copy exists because the UI has to
 * *show* the user what will happen before the run starts, which it cannot do from inside Rust.
 *
 * `0` is the sentinel for "let Liatir decide" — it is the default, and it is what a non-technical
 * user should never have to think about.
 */
import type { InputFieldSchema } from '$lib/types/pipeline';

export const AUTO_THREADS_VALUE = 0;
/** Ceiling when Liatir chooses: past this, these tools stop scaling and only add contention. */
export const MAX_AUTO_THREADS = 16;
/** Ceiling when the user chooses: high enough not to second-guess an expert, bounded against typos. */
export const MAX_MANUAL_THREADS = 128;

/** Browser core count, defaulting to 2 when the API is unavailable or nonsensical. */
export function availableLogicalCores(): number {
  const cores = globalThis.navigator?.hardwareConcurrency;
  return Number.isFinite(cores) && cores > 0 ? Math.trunc(cores) : 2;
}

/** One core reserved for the UI and the rest of the system — see the note at the top. */
export function autoThreadCount(): number {
  const cores = availableLogicalCores();
  const reserved = cores > 1 ? cores - 1 : 1;
  return Math.max(1, Math.min(MAX_AUTO_THREADS, reserved));
}

/**
 * Turns a raw form value into a usable thread count.
 *
 * Anything that is not a positive number — empty, `0`, text, NaN — means "auto". A form field yields
 * strings and blanks, and none of those should ever produce a broken command line.
 */
export function resolveThreadCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= AUTO_THREADS_VALUE) return autoThreadCount();
  return Math.max(1, Math.min(MAX_MANUAL_THREADS, Math.trunc(parsed)));
}

/** The resolved count *and* how it was arrived at, so the UI can label it "auto" rather than lie. */
export function threadParam(value: unknown): { threads: number; mode: 'auto' | 'manual' } {
  const parsed = typeof value === 'number' ? value : Number(value);
  return {
    threads: resolveThreadCount(value),
    mode: Number.isFinite(parsed) && parsed > AUTO_THREADS_VALUE ? 'manual' : 'auto',
  };
}

/**
 * The shared Threads field, so every tool exposes it identically rather than redefining it.
 * `connectable: false`: a thread count is a machine setting, not data to be wired from another node.
 */
export function threadInputSchema(description?: string): InputFieldSchema {
  return {
    type: 'number',
    label: 'Threads',
    required: false,
    default: AUTO_THREADS_VALUE,
    description: description ?? '0 lets Liatir choose a safe local thread count.',
    connectable: false,
  };
}

/** Displays the count, marking an auto-chosen one as such — "8 auto" reads very differently from "8". */
export function formatThreadFlag(value: unknown): string {
  const { threads, mode } = threadParam(value);
  return mode === 'auto' ? `${threads} auto` : String(threads);
}
