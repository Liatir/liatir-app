export const PIPELINE_CANCELLED_MESSAGE = 'Pipeline run cancelled by user.';

export class RunCancelledError extends Error {
  constructor(message = PIPELINE_CANCELLED_MESSAGE) {
    super(message);
    this.name = 'RunCancelledError';
  }
}

export function throwIfRunCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RunCancelledError();
}

export function isRunCancelled(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || error instanceof RunCancelledError
    || (error instanceof DOMException && error.name === 'AbortError');
}
