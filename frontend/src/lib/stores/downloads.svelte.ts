import { liatir } from '$lib/api';

export interface ActiveDownload {
  id: string;
  url: string;
  label: string;
  destPath: string;
  bytesDownloaded: number;
  bytesTotal: number | null;
  bytesPerSec: number;
  status: 'downloading' | 'done' | 'error' | 'cancelled';
  error: string | null;
  sha256Ok: boolean | null;
}

interface ProgressPayload {
  id: string;
  bytesDownloaded: number;
  bytesTotal: number | null;
  bytesPerSec: number;
  done: boolean;
  error: string | null;
}

function createDownloadsStore() {
  let downloads = $state<Map<string, ActiveDownload>>(new Map());
  const unlisteners: Map<string, () => void> = new Map();


  function get(id: string): ActiveDownload | undefined {
    return downloads.get(id);
  }

  function list(): ActiveDownload[] {
    return [...downloads.values()];
  }

  function active(): ActiveDownload[] {
    return list().filter(d => d.status === 'downloading');
  }

  async function start(opts: {
    id: string;
    url: string;
    label: string;
    destPath: string;
    sha256?: string;
  }): Promise<void> {
    const api = liatir();
    if (!api) throw new Error('Liatir API not available');

    downloads = new Map(downloads).set(opts.id, {
      id: opts.id,
      url: opts.url,
      label: opts.label,
      destPath: opts.destPath,
      bytesDownloaded: 0,
      bytesTotal: null,
      bytesPerSec: 0,
      status: 'downloading',
      error: null,
      sha256Ok: null,
    });

    // Await the listener registration so we get the unlisten fn, not a Promise
    const eventName = `managed:progress:${opts.id}`;
    const unlistenFn = await api.desktop.events.on(eventName, (raw: unknown) => {
      const p = raw as ProgressPayload;
      const existing = downloads.get(p.id);
      if (!existing) return;
      const next = new Map(downloads);
      if (p.done) {
        next.set(p.id, {
          ...existing,
          bytesDownloaded: p.bytesDownloaded,
          bytesTotal: p.bytesTotal,
          bytesPerSec: 0,
          status: p.error ? 'error' : 'done',
          error: p.error,
        });
      } else {
        next.set(p.id, {
          ...existing,
          bytesDownloaded: p.bytesDownloaded,
          bytesTotal: p.bytesTotal,
          bytesPerSec: p.bytesPerSec,
        });
      }
      downloads = next;
    }) as unknown as () => void;

    unlisteners.set(opts.id, unlistenFn);

    try {
      await api.invoke('lia_managed_download', {
        id: opts.id,
        url: opts.url,
        destPath: opts.destPath,
        sha256: opts.sha256 ?? null,
      });
    } catch (err: unknown) {
      const existing = downloads.get(opts.id);
      if (existing) {
        const next = new Map(downloads);
        next.set(opts.id, {
          ...existing,
          status: existing.bytesDownloaded > 0 ? 'cancelled' : 'error',
          error: String(err),
        });
        downloads = next;
      }
      throw err;
    } finally {
      cleanup(opts.id);
    }
  }

  function cancel(id: string) {
    const api = liatir();
    if (!api) return;
    api.invoke('lia_managed_download_cancel', { id });
  }

  function remove(id: string) {
    const next = new Map(downloads);
    next.delete(id);
    downloads = next;
    cleanup(id);
  }

  function cleanup(id: string) {
    const unlisten = unlisteners.get(id);
    if (unlisten) {
      unlisten();
      unlisteners.delete(id);
    }
  }

  return { get, list, active, start, cancel, remove };
}

export const downloadsStore = createDownloadsStore();
