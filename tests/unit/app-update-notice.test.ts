import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installSvelteRuneStubs } from './support/svelte-runes';

installSvelteRuneStubs();

const harness = vi.hoisted(() => ({
  check: vi.fn(),
  settings: {
    checkUpdatesAtStartup: true,
    skippedUpdateVersion: null as string | null,
    init: async () => undefined,
    skipUpdateVersion: async (version: string) => { harness.settings.skippedUpdateVersion = version; },
  },
}));

vi.mock('$lib/api', () => ({
  liatir: () => ({ desktop: { app: { updates: { check: harness.check } } } }),
}));
vi.mock('$lib/stores/settings.svelte', () => ({ settingsStore: harness.settings }));

/** A fresh store per test: the real one is a module singleton that checks once per launch. */
async function freshStore() {
  vi.resetModules();
  return (await import('../../frontend/src/lib/stores/appUpdate.svelte')).appUpdate;
}

const newer = { available: true, currentVersion: '0.1.0', version: '0.1.1' };

describe('the startup update notice', () => {
  beforeEach(() => {
    harness.check.mockReset();
    harness.settings.checkUpdatesAtStartup = true;
    harness.settings.skippedUpdateVersion = null;
  });

  it('opens once at startup for a newer version', async () => {
    harness.check.mockResolvedValue(newer);
    const store = await freshStore();
    await store.checkAtStartup();
    await store.checkAtStartup();
    expect(harness.check).toHaveBeenCalledTimes(1);
    expect(store.noticeOpen).toBe(true);
    expect(store.state).toBe('available');
  });

  it('stays closed for a skipped version, which Settings still offers, and reopens for the next one', async () => {
    harness.check.mockResolvedValue(newer);
    let store = await freshStore();
    await store.checkAtStartup();
    await store.skipNoticedVersion();
    expect(harness.settings.skippedUpdateVersion).toBe('0.1.1');
    expect(store.noticeOpen).toBe(false);

    store = await freshStore();
    await store.checkAtStartup();
    expect(store.noticeOpen).toBe(false);
    expect(store.state).toBe('available');

    harness.check.mockResolvedValue({ ...newer, version: '0.1.2' });
    store = await freshStore();
    await store.checkAtStartup();
    expect(store.noticeOpen).toBe(true);
  });

  it('closes for this launch only', async () => {
    harness.check.mockResolvedValue(newer);
    const store = await freshStore();
    await store.checkAtStartup();
    store.closeNotice();
    expect(store.noticeOpen).toBe(false);
    expect(harness.settings.skippedUpdateVersion).toBeNull();
  });

  it('says nothing when the automatic check fails or finds nothing', async () => {
    harness.check.mockRejectedValue(new Error('offline'));
    let store = await freshStore();
    await store.checkAtStartup();
    expect([store.state, store.message, store.noticeOpen]).toEqual(['idle', null, false]);

    harness.check.mockResolvedValue({ available: false, currentVersion: '0.1.0' });
    store = await freshStore();
    await store.checkAtStartup();
    expect([store.state, store.message, store.noticeOpen]).toEqual(['idle', null, false]);
  });

  it('runs a manual check pressed during the startup check instead of dropping it', async () => {
    let finishStartup = () => {};
    harness.check
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishStartup = () => resolve({ available: false, currentVersion: '0.1.0' });
      }))
      .mockResolvedValueOnce({ available: false, currentVersion: '0.1.0' });
    const store = await freshStore();
    const startup = store.checkAtStartup();
    await Promise.resolve();
    const manual = store.check();
    finishStartup();
    await Promise.all([startup, manual]);
    expect(harness.check).toHaveBeenCalledTimes(2);
    expect([store.state, store.message]).toEqual(['up-to-date', 'Liatir 0.1.0 is up to date.']);
  });

  it('reports a manual check, and never contacts the feed at startup when turned off', async () => {
    harness.settings.checkUpdatesAtStartup = false;
    const store = await freshStore();
    await store.checkAtStartup();
    expect(harness.check).not.toHaveBeenCalled();

    harness.check.mockRejectedValue(new Error('offline'));
    await store.check();
    expect([store.state, store.message]).toEqual(['error', 'offline']);
  });
});
