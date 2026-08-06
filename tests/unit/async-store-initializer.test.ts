/**
 * Tests the store initializer's two guarantees: concurrent callers share one load, and a load invalidated by a
 * reset cannot commit its results afterwards.
 *
 * The second is the one that matters in practice. It is what stops a workspace's data being written into a
 * *different* workspace when the user switches while a load is still in flight — a bug that would be nearly
 * impossible to reproduce by hand and trivially caught here.
 */
import { describe, expect, it, vi } from 'vitest';

import { createAsyncStoreInitializer } from '../../frontend/src/lib/stores/async-store-initializer';

describe('createAsyncStoreInitializer', () => {
  it('shares one in-flight initialization across concurrent callers', async () => {
    const initializer = createAsyncStoreInitializer();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = vi.fn(async () => blocked);

    const first = initializer.run(load);
    const second = initializer.run(load);
    expect(load).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, second]);
    await initializer.run(load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('invalidates stale work when the owning store resets', async () => {
    const initializer = createAsyncStoreInitializer();
    let firstIsCurrent: (() => boolean) | undefined;

    await initializer.run(async (isCurrent) => {
      firstIsCurrent = isCurrent;
    });
    expect(firstIsCurrent?.()).toBe(true);

    initializer.reset();
    expect(firstIsCurrent?.()).toBe(false);

    let nextIsCurrent = false;
    await initializer.run(async (isCurrent) => {
      nextIsCurrent = isCurrent();
    });
    expect(nextIsCurrent).toBe(true);
  });
});
