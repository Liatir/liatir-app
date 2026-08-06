/**
 * Distinguishing "the user cancelled this" from "this failed".
 *
 * Both arrive at a `catch` as a thrown value, but they mean opposite things: a cancelled run is not
 * an error and must not be reported as one — no red toast, no failure in Results, nothing for the
 * user to investigate. Getting this wrong is how a deliberate stop turns into an alarming error the
 * user then tries to debug.
 */
export const PIPELINE_CANCELLED_MESSAGE = 'Pipeline run cancelled by user.';

/** Thrown by cooperative cancellation points inside a run. */
export class RunCancelledError extends Error {
  constructor(message = PIPELINE_CANCELLED_MESSAGE) {
    super(message);
    this.name = 'RunCancelledError';
  }
}

/**
 * The cancellation checkpoint, called between the steps of a long run.
 *
 * Cancellation is cooperative: a running step cannot be interrupted mid-flight, so a run stops at the
 * next checkpoint. Sprinkling these between steps is what makes a cancel feel immediate.
 */
export function throwIfRunCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RunCancelledError();
}

/**
 * Was this a cancellation? Three signals, because cancellation surfaces in three different shapes:
 *
 *   - the signal is aborted — the most reliable check, and true even if the error came from elsewhere
 *     (a fetch that failed *because* the run was being torn down);
 *   - our own `RunCancelledError`, from a checkpoint above;
 *   - a `DOMException` named `AbortError`, which is what the web platform throws when an aborted
 *     signal kills a `fetch`.
 */
export function isRunCancelled(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || error instanceof RunCancelledError
    || (error instanceof DOMException && error.name === 'AbortError');
}
