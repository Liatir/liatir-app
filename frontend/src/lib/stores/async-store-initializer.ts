type StoreLoader = (isCurrent: () => boolean) => Promise<void>;

export function createAsyncStoreInitializer() {
  let initialized = false;
  let pending: Promise<void> | null = null;
  let generation = 0;

  return {
    async run(load: StoreLoader): Promise<void> {
      if (pending) {
        await pending;
        return;
      }
      if (initialized) return;
      initialized = true;

      const currentGeneration = generation;
      const task = load(() => generation === currentGeneration);
      pending = task;

      try {
        await task;
      } finally {
        if (pending === task) pending = null;
      }
    },

    reset() {
      generation += 1;
      pending = null;
      initialized = false;
    },
  };
}
