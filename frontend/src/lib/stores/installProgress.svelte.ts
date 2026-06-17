export interface InstallItem {
  binary: string;
  label: string;
  phase: 'downloading' | 'extracting' | 'pm-installing' | 'done' | 'error';
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

    start(binary: string, label: string) {
      items = {
        ...items,
        [binary]: { binary, label, phase: 'downloading', bytesDownloaded: 0, bytesTotal: null, error: null },
      };
    },

    update(binary: string, patch: Partial<InstallItem>) {
      if (!items[binary]) return;
      items = { ...items, [binary]: { ...items[binary], ...patch } };
    },

    done(binary: string) {
      if (!items[binary]) return;
      items = { ...items, [binary]: { ...items[binary], phase: 'done', error: null } };
      setTimeout(() => remove(binary), 3500);
    },

    error(binary: string, message: string) {
      if (!items[binary]) return;
      items = { ...items, [binary]: { ...items[binary], phase: 'error', error: message } };
      setTimeout(() => remove(binary), 10000);
    },

    dismiss(binary: string) { remove(binary); },
  };
}

export const installProgress = createInstallProgressStore();
