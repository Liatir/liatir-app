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
