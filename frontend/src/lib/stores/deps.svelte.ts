import { liatir } from '$lib/api';
import { GLOBAL_DEPENDENCY_BINARIES } from '$lib/data/dep-requirements';

export interface DepResult {
  binary: string;
  available: boolean;
  path: string | null;
  version: string | null;
}

export interface DependencyProcessState {
  phase: 'idle' | 'downloading' | 'extracting' | 'done' | 'error' | 'pm-installing';
  bytesDownloaded: number;
  bytesTotal: number | null;
  error: string | null;
  pmLog: string[];
  pmOperation: 'install' | 'update' | null;
  showLog: boolean;
  updatedAt: number | null;
}

export const COMMON_TOOLS = GLOBAL_DEPENDENCY_BINARIES;

function uniqueBinaries(binaries: string[]): string[] {
  return [...new Set(binaries.map((binary) => binary.trim()).filter(Boolean))];
}

export function defaultDependencyProcessState(): DependencyProcessState {
  return {
    phase: 'idle',
    bytesDownloaded: 0,
    bytesTotal: null,
    error: null,
    pmLog: [],
    pmOperation: null,
    showLog: false,
    updatedAt: null,
  };
}

function createDepsStore() {
  let results = $state<DepResult[]>([]);
  let loading = $state(false);
  let checked = $state(false);
  let processStates = $state<Record<string, DependencyProcessState>>({});
  let checkAllPromise: Promise<void> | null = null;

  return {
    get results() { return results; },
    get loading() { return loading; },
    get checked() { return checked; },
    get processStates() { return processStates; },

    get availableCount() {
      return results.filter((r) => r.available).length;
    },

    processState(key: string): DependencyProcessState {
      return processStates[key] ?? defaultDependencyProcessState();
    },

    setProcessState(key: string, patch: Partial<DependencyProcessState>) {
      processStates = {
        ...processStates,
        [key]: {
          ...defaultDependencyProcessState(),
          ...(processStates[key] ?? {}),
          ...patch,
          updatedAt: Date.now(),
        },
      };
    },

    appendProcessLog(key: string, line: string) {
      const current = processStates[key] ?? defaultDependencyProcessState();
      processStates = {
        ...processStates,
        [key]: {
          ...current,
          pmLog: [...current.pmLog, line],
          updatedAt: Date.now(),
        },
      };
    },

    async checkAll(extraBinaries: string[] = [], options: { force?: boolean } = {}) {
      const api = liatir();
      if (!api) return;
      const binaries = uniqueBinaries([...COMMON_TOOLS, ...extraBinaries]);
      if (
        !options.force
        && checked
        && binaries.every((binary) => results.some((result) => result.binary === binary))
      ) {
        return;
      }
      if (checkAllPromise) return checkAllPromise;
      loading = true;
      checkAllPromise = (async () => {
        results = await api.deps.checkMany(binaries);
        checked = true;
      })().finally(() => {
        loading = false;
        checkAllPromise = null;
      });
      return checkAllPromise;
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

    reset() {
      results = [];
      loading = false;
      checked = false;
      processStates = {};
      checkAllPromise = null;
    },
  };
}

export const depsStore = createDepsStore();
