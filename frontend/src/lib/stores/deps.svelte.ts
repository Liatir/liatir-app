import { liatir } from '$lib/api';
import { GLOBAL_DEPENDENCY_BINARIES } from '$lib/data/dep-requirements';

export interface DepResult {
  binary: string;
  available: boolean;
  path: string | null;
  version: string | null;
}

export const COMMON_TOOLS = GLOBAL_DEPENDENCY_BINARIES;

function uniqueBinaries(binaries: string[]): string[] {
  return [...new Set(binaries.map((binary) => binary.trim()).filter(Boolean))];
}

function createDepsStore() {
  let results = $state<DepResult[]>([]);
  let loading = $state(false);
  let checked = $state(false);

  return {
    get results() { return results; },
    get loading() { return loading; },
    get checked() { return checked; },

    get availableCount() {
      return results.filter((r) => r.available).length;
    },

    async checkAll(extraBinaries: string[] = []) {
      const api = liatir();
      if (!api) return;
      loading = true;
      try {
        results = await api.deps.checkMany(uniqueBinaries([...COMMON_TOOLS, ...extraBinaries]));
        checked = true;
      } finally {
        loading = false;
      }
    },

    async checkOne(binary: string): Promise<DepResult | null> {
      const api = liatir();
      if (!api) return null;
      return await api.deps.check(binary);
    },

    async recheckOne(binary: string): Promise<void> {
      const api = liatir();
      if (!api) return;
      const result = await api.deps.check(binary);
      if (!result) return;
      const idx = results.findIndex(r => r.binary === binary);
      if (idx >= 0) {
        results = results.map((item, index) => index === idx ? result : item);
      } else {
        results = [...results, result];
      }
    },
  };
}

export const depsStore = createDepsStore();
