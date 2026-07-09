import { describe, expect, it } from 'vitest';

import {
  isRunCancelled,
  PIPELINE_CANCELLED_MESSAGE,
  RunCancelledError,
  throwIfRunCancelled,
} from '../../frontend/src/lib/pipeline/cancellation';

describe('pipeline cancellation contract', () => {
  it('uses a stable user-facing cancellation error', () => {
    const error = new RunCancelledError();
    expect(error.name).toBe('RunCancelledError');
    expect(error.message).toBe(PIPELINE_CANCELLED_MESSAGE);
    expect(isRunCancelled(error)).toBe(true);
  });

  it('detects an aborted per-run signal', () => {
    const controller = new AbortController();
    expect(isRunCancelled(new Error('unrelated'), controller.signal)).toBe(false);
    controller.abort();
    expect(() => throwIfRunCancelled(controller.signal)).toThrow(RunCancelledError);
    expect(isRunCancelled(new Error('unrelated'), controller.signal)).toBe(true);
  });
});
