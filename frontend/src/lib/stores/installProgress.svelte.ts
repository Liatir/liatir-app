/**
 * Global, always-visible progress for dependency installs.
 *
 * Keyed by binary, so several tools can install at once and each gets its own row. This is what
 * lets the user start an install and then navigate away: the progress lives here, in a store, not
 * in the page that started it, so leaving the Dependencies screen does not cancel or hide it.
 */
export interface InstallItem {
  binary: string;
  label: string;
  phase: 'downloading' | 'extracting' | 'pm-installing' | 'recoverable' | 'done' | 'error';
  runId?: string;
  bytesDownloaded: number;
  bytesTotal: number | null;
  error: string | null;
}

function createInstallProgressStore() {
  let items = $state<Record<string, InstallItem>>({});

  function remove(binary: string) {
    const next = { ...items };
    delete next[binary];
    items = next;
  }

  return {
    get list(): InstallItem[] { return Object.values(items); },
    get hasAny(): boolean { return Object.keys(items).length > 0; },

    start(binary: string, label: string, runId?: string) {
      items = {
        ...items,
        [binary]: { binary, label, phase: 'downloading', runId, bytesDownloaded: 0, bytesTotal: null, error: null },
      };
    },

    recoverable(binary: string, label: string, message: string) {
      items = {
        ...items,
        [binary]: {
          binary,
          label,
          phase: 'recoverable',
          bytesDownloaded: 0,
          bytesTotal: null,
          error: message,
        },
      };
    },

    update(binary: string, patch: Partial<InstallItem>) {
      if (!items[binary]) return;
      items = { ...items, [binary]: { ...items[binary], ...patch } };
    },

    /** Marks success and lets the row linger briefly, so the user sees it completed. */
    done(binary: string) {
      if (!items[binary]) return;
      items = { ...items, [binary]: { ...items[binary], phase: 'done', error: null } };
      setTimeout(() => remove(binary), 3500);
    },

    /** Marks failure. Held much longer than a success — an error is something the user must read. */
    error(binary: string, message: string) {
      if (!items[binary]) return;
      items = { ...items, [binary]: { ...items[binary], phase: 'error', error: message } };
      setTimeout(() => remove(binary), 10000);
    },

    dismiss(binary: string) { remove(binary); },
  };
}

export const installProgress = createInstallProgressStore();
