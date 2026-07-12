/**
 * Shared "load once, and never let a stale load win" helper for the stores.
 *
 * Two problems it solves, both of which bite when the user switches workspace mid-load:
 *
 *   1. **Duplicate work.** Several components mounting at once each call `init()`. The `pending`
 *      promise makes them all await the same load instead of each starting one.
 *
 *   2. **Stale writes.** A load started for workspace A can still be in flight when the user
 *      switches to workspace B. If it then commits its data, workspace A's contents appear inside
 *      workspace B. The `generation` counter is the guard: `reset()` bumps it, which makes the
 *      in-flight loader's `isCurrent()` return false, and the loader is expected to check that
 *      before writing anything to the store.
 */
type StoreLoader = (isCurrent: () => boolean) => Promise<void>;

export function createAsyncStoreInitializer() {
  let initialized = false;
  let pending: Promise<void> | null = null;
  /** Bumped on every reset; a loader captures it at start and compares to detect being superseded. */
  let generation = 0;

  return {
    async run(load: StoreLoader): Promise<void> {
      // A load is already running — join it rather than starting a second.
      if (pending) {
        await pending;
        return;
      }
      if (initialized) return;
      initialized = true;

      // Captured before the loader starts: this is the identity it must still have to be allowed
      // to commit its results.
      const currentGeneration = generation;
      const task = load(() => generation === currentGeneration);
      pending = task;

      try {
        await task;
      } finally {
        // Only clear `pending` if it is still *our* task: a reset during the load may have started
        // a newer one, and clobbering that would let a third caller start yet another.
        if (pending === task) pending = null;
      }
    },

    /** Invalidates any in-flight load and allows a fresh one. Does not delete anything on disk. */
    reset() {
      generation += 1;
      pending = null;
      initialized = false;
    },
  };
}
