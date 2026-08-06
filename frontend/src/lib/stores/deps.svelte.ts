/**
 * Store for external command-line dependencies (samtools, bwa, python, …).
 *
 * These are real binaries on the user's machine, not something Liatir bundles. Two separate
 * concerns live here, and keeping them apart is the whole design:
 *
 *   - **detection** (`results`): is the binary present, where, and at what version;
 *   - **installation** (`processStates`): the progress of installing or updating one, keyed per
 *     dependency so a long Homebrew install of one tool never freezes the UI for the others.
 */
import { liatir } from '$lib/api';
import { GLOBAL_DEPENDENCY_BINARIES } from '$lib/data/dep-requirements';

/** What a detection probe found. `available: false` means "not on PATH", not "install failed". */
export interface DepResult {
  binary: string;
  available: boolean;
  path: string | null;
  version: string | null;
}

/** Progress of an install/update for one dependency. */
export interface DependencyProcessState {
  phase: 'idle' | 'downloading' | 'extracting' | 'done' | 'error' | 'pm-installing';
  bytesDownloaded: number;
  bytesTotal: number | null;
  error: string | null;
  /** Package-manager output, kept so a failed install can be explained rather than just reported. */
  pmLog: string[];
  pmOperation: 'install' | 'update' | null;
  showLog: boolean;
  updatedAt: number | null;
}

export const COMMON_TOOLS = GLOBAL_DEPENDENCY_BINARIES;

/** Deduplicates so a binary required by several tools is probed once, not once per requester. */
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

    /**
     * Progress for one dependency, defaulting to idle. Returning a default rather than `undefined`
     * means components can bind to it directly without a null check on every field.
     */
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

    /**
     * Probes the common dependencies plus any extra ones a page needs.
     *
     * Probing shells out once per binary, so it is not free. Two guards keep it from re-running
     * needlessly: the cache is reused only when it already covers *every* requested binary (a page
     * asking for a new tool still triggers a check), and concurrent callers share one in-flight
     * probe rather than each launching their own.
     */
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

    /**
     * Re-probes one binary and folds the result back into the cached list — used right after an
     * install, so the UI flips from "missing" to "available" without re-probing everything else.
     *
     * The result replaces the existing entry if there is one, and is appended otherwise (the binary
     * may not have been in the list before it was installed).
     */
    async recheckOne(binary: string): Promise<void> {
      const api = liatir();
      if (!api) return;
      const result = await api.deps.check(binary);
      if (!result) return;
      const idx = results.findIndex(r => r.binary === binary);
      if (idx >= 0) {
        // Rebuilt rather than mutated in place, so the reactive array actually notifies its readers.
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
