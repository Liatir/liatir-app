/**
 * Index of the command-line binaries Liatir installed itself.
 *
 * The distinction from the dependency store matters: `deps` records what it *found* on the machine
 * (which may be a Homebrew install, a system package, anything). This records only what Liatir
 * downloaded and manages — so it knows what it is allowed to remove or update, and never touches a
 * tool the user installed themselves.
 *
 * `platform` and `arch` are stored with each entry because a binary downloaded for one architecture
 * is useless on another, which matters when a home directory is copied between machines.
 */
import { liatir } from '$lib/api';

export interface ManagedBinary {
  binary: string;
  version: string;
  path: string;
  platform: string;
  arch: string;
  installedAt: number;
}

interface ManagedBinsIndex {
  bins: Record<string, ManagedBinary>;
}

const INDEX_PATH = 'managed-bins/index.json';

function createManagedBinsStore() {
  let bins = $state<Record<string, ManagedBinary>>({});
  let initialized = $state(false);

  return {
    get bins() { return bins; },
    get initialized() { return initialized; },

    get(binary: string): ManagedBinary | null {
      return bins[binary] ?? null;
    },

    /** Loads the index. A missing or unreadable file simply means nothing is managed yet. */
    async init(): Promise<void> {
      if (initialized) return;
      const api = liatir();
      if (!api) return;
      try {
        if (await api.desktop.fs.data.exists(INDEX_PATH)) {
          const raw = await api.desktop.fs.data.readText(INDEX_PATH);
          const index: ManagedBinsIndex = JSON.parse(raw);
          bins = index.bins ?? {};
        }
      } catch { /* first run */ }
      initialized = true;
    },

    async save(entry: ManagedBinary): Promise<void> {
      bins = { ...bins, [entry.binary]: entry };
      await this._persist();
    },

    async remove(binary: string): Promise<void> {
      const { [binary]: _, ...rest } = bins;
      bins = rest;
      await this._persist();
    },

    async _persist(): Promise<void> {
      const api = liatir();
      if (!api) return;
      const index: ManagedBinsIndex = { bins };
      await api.desktop.fs.data.writeText(
        INDEX_PATH,
        JSON.stringify(index, null, 2),
        { createDirs: true },
      );
    },
  };
}

export const managedBins = createManagedBinsStore();
