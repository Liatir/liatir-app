import type {
  LiatirInstalledSingleCellIndex,
  LiatirSingleCellIndexCatalogEntry,
} from '@liatir/core';
import { liatir } from '$lib/api';
import { dataFiles } from './dataFiles.svelte';

export interface SingleCellIndexProgress {
  status: 'idle' | 'downloading' | 'installing' | 'error';
  bytesDownloaded: number;
  bytesTotal: number | null;
  error: string | null;
}

interface DownloadProgress {
  bytesDownloaded: number;
  bytesTotal: number | null;
  done: boolean;
  error: string | null;
}

const idleProgress = (): SingleCellIndexProgress => ({
  status: 'idle',
  bytesDownloaded: 0,
  bytesTotal: null,
  error: null,
});

function identity(id: string, version: string) {
  return `${id}@${version}`;
}

function createSingleCellIndexesStore() {
  let catalog = $state<LiatirSingleCellIndexCatalogEntry[]>([]);
  let installed = $state<LiatirInstalledSingleCellIndex[]>([]);
  let loading = $state(false);
  let catalogSource = $state<'network' | 'cache' | null>(null);
  let catalogError = $state<string | null>(null);
  let progress = $state<Map<string, SingleCellIndexProgress>>(new Map());
  const activeDownloadIds = new Map<string, string>();

  function setProgress(key: string, value: SingleCellIndexProgress) {
    progress = new Map(progress).set(key, value);
  }

  async function refresh() {
    const api = liatir();
    if (!api) return;
    loading = true;
    catalogError = null;
    const [catalogResult, installedResult] = await Promise.allSettled([
      api.singleCellIndexes.catalog(),
      api.singleCellIndexes.installed(),
    ]);
    if (catalogResult.status === 'fulfilled') {
      catalog = catalogResult.value.catalog.indexes;
      catalogSource = catalogResult.value.source;
    } else {
      catalogError = String(catalogResult.reason);
    }
    if (installedResult.status === 'fulfilled') installed = installedResult.value;
    loading = false;
  }

  async function install(entry: LiatirSingleCellIndexCatalogEntry) {
    const api = liatir();
    if (!api) throw new Error('Liatir desktop API is unavailable.');
    const key = identity(entry.id, entry.version);
    const downloadId = `single-cell-index-${entry.id}-${crypto.randomUUID()}`;
    activeDownloadIds.set(key, downloadId);
    setProgress(key, { ...idleProgress(), status: 'downloading' });

    const unlisten = await api.desktop.events.on(
      `managed:progress:${downloadId}`,
      (raw: unknown) => {
        const event = raw as DownloadProgress;
        setProgress(key, {
          status: event.done && !event.error ? 'installing' : 'downloading',
          bytesDownloaded: event.bytesDownloaded,
          bytesTotal: event.bytesTotal,
          error: event.error,
        });
      },
    ) as unknown as () => void;
    try {
      const result = await api.singleCellIndexes.install(entry.id, entry.version, downloadId);
      installed = [
        result.installed,
        ...installed.filter((item) =>
          item.id !== result.installed.id
          || item.version !== result.installed.version
          || item.archiveSha256 !== result.installed.archiveSha256
        ),
      ];
      await dataFiles.init();
      await dataFiles.createFolder('Reference indexes');
      await dataFiles.add(result.installed.manifestPath, 'Reference indexes');
      setProgress(key, idleProgress());
      return result;
    } catch (error) {
      setProgress(key, {
        ...(progress.get(key) ?? idleProgress()),
        status: 'error',
        error: String(error),
      });
      throw error;
    } finally {
      activeDownloadIds.delete(key);
      unlisten();
    }
  }

  async function remove(item: LiatirInstalledSingleCellIndex) {
    const api = liatir();
    if (!api) throw new Error('Liatir desktop API is unavailable.');
    await api.singleCellIndexes.remove(item.id, item.version, item.archiveSha256);
    await dataFiles.removeUnder([item.installDir]);
    installed = installed.filter((candidate) =>
      candidate.id !== item.id
      || candidate.version !== item.version
      || candidate.archiveSha256 !== item.archiveSha256
    );
    progress = new Map(progress);
    progress.delete(identity(item.id, item.version));
  }

  function cancel(entry: LiatirSingleCellIndexCatalogEntry) {
    // Cancellation is intentionally routed through the shared managed-download command. The native
    // install keeps its partial archive so the next click resumes instead of starting from zero.
    const api = liatir();
    if (!api) return;
    const downloadId = activeDownloadIds.get(identity(entry.id, entry.version));
    if (downloadId) void api.invoke('lia_managed_download_cancel', { id: downloadId });
  }

  return {
    get catalog() { return catalog; },
    get installed() { return installed; },
    get loading() { return loading; },
    get catalogSource() { return catalogSource; },
    get catalogError() { return catalogError; },
    progressFor(entry: LiatirSingleCellIndexCatalogEntry) {
      return progress.get(identity(entry.id, entry.version)) ?? idleProgress();
    },
    installedFor(entry: LiatirSingleCellIndexCatalogEntry) {
      return installed.find((item) =>
        item.id === entry.id
        && item.version === entry.version
        && item.archiveSha256 === entry.archive.sha256
      );
    },
    refresh,
    install,
    remove,
    cancel,
  };
}

export const singleCellIndexes = createSingleCellIndexesStore();
