import {
  createLiatirRootExecutionIdentity,
  liatirExecutionMetadata,
  type LiatirInstalledSnpEffDatabase,
  type LiatirSnpEffDatabaseCatalogEntry,
  type LiatirSnpEffSuiteStatus,
} from '@liatir/core';
import { liatir } from '$lib/api';
import { executionRuns } from './executionRuns.svelte';
import { installProgress } from './installProgress.svelte';
import { jobsStore } from './jobs.svelte';
import { workspaceStore } from './workspace.svelte';

export interface SnpEffConfig {
  /** Advanced compatibility path. New users install the verified managed suite instead. */
  externalJarPath: string | null;
  /** Data directory belonging to an external SnpEff installation. */
  externalDataDir: string;
  /** Legacy external databases recorded by older Liatir versions. */
  externalDatabases: string[];
  lastUsed: Record<string, number>;
  jvmHeap: string;
}

export interface SnpEffManagedProgress {
  status: 'idle' | 'downloading' | 'installing' | 'error';
  bytesDownloaded: number;
  bytesTotal: number | null;
  error: string | null;
  runId: string | null;
}

export interface SnpEffRuntimeSnapshot {
  source: 'managed' | 'external';
  snpEffJar: string;
  snpSiftJar: string | null;
  dataDir: string;
  suiteVersion: string | null;
  suiteArchiveSha256: string | null;
  database: {
    id: string;
    suiteVersion: string | null;
    databaseSeries: string | null;
    archiveSha256: string | null;
    source: 'managed' | 'external';
  } | null;
}

interface LegacySnpEffConfig extends Partial<SnpEffConfig> {
  jarPath?: string | null;
  dataDir?: string;
  downloadedGenomes?: string[];
}

interface ManagedDownloadProgress {
  bytesDownloaded?: number;
  bytesTotal?: number | null;
  done?: boolean;
  error?: string | null;
}

const CONFIG_FILENAME = 'snpeff-config.json';
const SUITE_PROGRESS_KEY = 'snpeff-suite';

const idleProgress = (): SnpEffManagedProgress => ({
  status: 'idle',
  bytesDownloaded: 0,
  bytesTotal: null,
  error: null,
  runId: null,
});

function databaseKey(id: string, suiteVersion: string) {
  return `snpeff-database:${id}@${suiteVersion}`;
}

function siblingJar(path: string, filename: string): string {
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/';
  const directory = path.replace(/[\\/][^\\/]+$/, '');
  return `${directory}${separator}${filename}`;
}

async function fileExists(path: string): Promise<boolean> {
  const api = liatir();
  if (!api || !path) return false;
  try {
    return Number(await api.invoke('lia_file_size', { path })) > 0;
  } catch {
    return false;
  }
}

function createSnpEffStore() {
  let config = $state<SnpEffConfig>({
    externalJarPath: null,
    externalDataDir: '',
    externalDatabases: [],
    lastUsed: {},
    jvmHeap: '8g',
  });
  let status = $state<LiatirSnpEffSuiteStatus | null>(null);
  let loaded = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let progress = $state<Map<string, SnpEffManagedProgress>>(new Map());
  const activeOperations = new Map<string, { runId: string; downloadId: string }>();
  let initPromise: Promise<void> | null = null;

  function setProgress(key: string, value: SnpEffManagedProgress) {
    progress = new Map(progress).set(key, value);
  }

  async function loadConfig() {
    const api = liatir();
    if (!api) return;
    const { data } = await api.invoke('lia_fs_paths') as { data: string; cache: string };
    const defaultDataDir = `${data}/snpeff-data`;
    try {
      const raw = await api.invoke('lia_read_file_text', { path: `${data}/${CONFIG_FILENAME}` }) as string;
      const parsed = JSON.parse(raw) as LegacySnpEffConfig;
      config = {
        externalJarPath: parsed.externalJarPath ?? parsed.jarPath ?? null,
        externalDataDir: parsed.externalDataDir ?? parsed.dataDir ?? defaultDataDir,
        externalDatabases: parsed.externalDatabases ?? parsed.downloadedGenomes ?? [],
        lastUsed: parsed.lastUsed ?? {},
        jvmHeap: parsed.jvmHeap ?? '8g',
      };
    } catch {
      config = {
        externalJarPath: null,
        externalDataDir: defaultDataDir,
        externalDatabases: [],
        lastUsed: {},
        jvmHeap: '8g',
      };
    }
  }

  async function save() {
    const api = liatir();
    if (!api) return;
    const { data } = await api.invoke('lia_fs_paths') as { data: string; cache: string };
    await api.invoke('lia_write_file_path', {
      path: `${data}/${CONFIG_FILENAME}`,
      content: JSON.stringify(config, null, 2),
    });
  }

  async function refresh() {
    const api = liatir();
    if (!api) return;
    loading = true;
    error = null;
    try {
      status = await api.snpEffSuite.status();
    } catch (cause) {
      error = String(cause);
      throw cause;
    } finally {
      loading = false;
    }
  }

  async function init() {
    if (loaded) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!liatir()) return;
      await loadConfig();
      await refresh();
      loaded = true;
    })().finally(() => {
      initPromise = null;
    });
    return initPromise;
  }

  async function runManagedInstall<T>(options: {
    key: string;
    label: string;
    entityId: string;
    params: Record<string, string>;
    invoke: (downloadId: string, jobId: string) => Promise<T>;
  }): Promise<T> {
    const api = liatir();
    if (!api) throw new Error('Liatir desktop API is unavailable.');
    const workspaceId = workspaceStore.activeId;
    if (!workspaceId) throw new Error('Select a workspace before installing SnpEff resources.');
    if (activeOperations.has(options.key)) {
      throw new Error('That SnpEff resource is already being installed.');
    }

    const runId = crypto.randomUUID();
    const downloadId = `${options.key.replace(/[^a-zA-Z0-9_-]/g, '-')}-${crypto.randomUUID()}`;
    const identity = createLiatirRootExecutionIdentity({
      runId,
      runKind: 'dependency',
      workspaceId,
      entityId: options.entityId,
    });
    await executionRuns.begin({
      identity,
      label: options.label,
      resultPolicy: 'none',
      params: options.params,
    });
    const logical = await jobsStore.beginLogical(options.entityId, {
      label: options.label,
      kind: 'dependency',
      metadata: {
        ...liatirExecutionMetadata(identity),
        dependencyId: options.entityId,
        ...options.params,
      },
    });
    if (!logical) {
      await executionRuns.finish(runId, 'error', 'Could not create the dependency Job.');
      throw new Error('Could not create the dependency Job.');
    }
    await executionRuns.attachJob(runId, logical.jobId);
    activeOperations.set(options.key, { runId, downloadId });
    setProgress(options.key, { ...idleProgress(), status: 'downloading', runId });
    installProgress.start(options.key, options.label, runId);

    const unlisten = await api.desktop.events.on(
      `managed:progress:${downloadId}`,
      (raw: unknown) => {
        const event = raw as ManagedDownloadProgress;
        const phase = event.done && !event.error ? 'installing' : 'downloading';
        setProgress(options.key, {
          status: event.error ? 'error' : phase,
          bytesDownloaded: event.bytesDownloaded ?? 0,
          bytesTotal: event.bytesTotal ?? null,
          error: event.error ?? null,
          runId,
        });
        installProgress.update(options.key, {
          phase: phase === 'installing' ? 'extracting' : 'downloading',
          bytesDownloaded: event.bytesDownloaded ?? 0,
          bytesTotal: event.bytesTotal ?? null,
          error: event.error ?? null,
        });
      },
    ) as unknown as () => void;

    try {
      const result = await options.invoke(downloadId, logical.jobId);
      await refresh();
      await executionRuns.finish(runId, 'done');
      installProgress.done(options.key);
      setProgress(options.key, idleProgress());
      return result;
    } catch (cause) {
      const message = String(cause);
      const cancelled = executionRuns.byId(runId)?.status === 'cancelling'
        || message.toLowerCase().includes('cancel');
      await executionRuns.finish(runId, cancelled ? 'cancelled' : 'error', message);
      installProgress.error(options.key, message);
      setProgress(options.key, {
        ...(progress.get(options.key) ?? idleProgress()),
        status: 'error',
        error: message,
        runId: null,
      });
      throw cause;
    } finally {
      activeOperations.delete(options.key);
      unlisten();
      await jobsStore.refresh().catch(() => {});
    }
  }

  async function installSuite(version?: string) {
    await init();
    const api = liatir();
    if (!api || !status) throw new Error('The SnpEff catalog is unavailable.');
    const selectedVersion = version ?? status.catalog.recommendedVersion;
    return runManagedInstall({
      key: SUITE_PROGRESS_KEY,
      label: `Install SnpEff + SnpSift ${selectedVersion}`,
      entityId: 'snpeff-suite',
      params: { snpeffSuiteVersion: selectedVersion },
      invoke: (downloadId, jobId) => api.snpEffSuite.install(selectedVersion, downloadId, jobId),
    });
  }

  async function installDatabase(entry: LiatirSnpEffDatabaseCatalogEntry) {
    await init();
    const api = liatir();
    if (!api) throw new Error('Liatir desktop API is unavailable.');
    const key = databaseKey(entry.id, entry.suiteVersion);
    return runManagedInstall({
      key,
      label: `Install ${entry.label}`,
      entityId: 'snpeff-database',
      params: {
        snpeffDatabaseId: entry.id,
        snpeffSuiteVersion: entry.suiteVersion,
        snpeffDatabaseSha256: entry.archive.sha256,
      },
      invoke: (downloadId, jobId) => api.snpEffSuite.installDatabase(
        entry.id,
        entry.suiteVersion,
        downloadId,
        jobId,
      ),
    });
  }

  async function removeSuite() {
    const api = liatir();
    if (!api) throw new Error('Liatir desktop API is unavailable.');
    const removed = await api.snpEffSuite.remove();
    await refresh();
    return removed;
  }

  async function removeDatabase(database: LiatirInstalledSnpEffDatabase) {
    const api = liatir();
    if (!api) throw new Error('Liatir desktop API is unavailable.');
    const removed = await api.snpEffSuite.removeDatabase(database);
    await refresh();
    return removed;
  }

  async function cancel(key: string) {
    const operation = activeOperations.get(key);
    if (!operation) return;
    await executionRuns.cancel(operation.runId);
  }

  async function setExternalJarPath(path: string | null) {
    config = { ...config, externalJarPath: path };
    await save();
  }

  async function setExternalDataDir(path: string) {
    config = { ...config, externalDataDir: path };
    await save();
  }

  async function touchGenome(genome: string) {
    config = { ...config, lastUsed: { ...config.lastUsed, [genome]: Date.now() } };
    await save();
  }

  async function checkExternalGenomePresent(genome: string): Promise<boolean> {
    if (!config.externalDataDir || !genome.trim()) return false;
    return fileExists(`${config.externalDataDir}/${genome}/snpEffectPredictor.bin`);
  }

  async function captureSnpEffRuntime(
    genome: string,
    preferExternal = false,
  ): Promise<SnpEffRuntimeSnapshot> {
    await init();
    await refresh();
    const active = status?.active;
    if (active && !preferExternal) {
      const database = status?.databases.find((item) =>
        item.id === genome && item.suiteVersion === active.version
      );
      if (!database) {
        throw new Error(`Install the verified ${genome} database before running SnpEff.`);
      }
      return {
        source: 'managed',
        snpEffJar: active.components.snpEff.path,
        snpSiftJar: active.components.snpSift.path,
        dataDir: status!.dataDir,
        suiteVersion: active.version,
        suiteArchiveSha256: active.archiveSha256,
        database: {
          id: database.id,
          suiteVersion: database.suiteVersion,
          databaseSeries: database.databaseSeries,
          archiveSha256: database.archiveSha256,
          source: 'managed',
        },
      };
    }

    const jar = config.externalJarPath;
    if (!jar || !await fileExists(jar)) {
      throw new Error('Install the verified SnpEff + SnpSift suite first.');
    }
    if (!await checkExternalGenomePresent(genome)) {
      throw new Error(`The external SnpEff database ${genome} is not available.`);
    }
    const snpSift = siblingJar(jar, 'SnpSift.jar');
    return {
      source: 'external',
      snpEffJar: jar,
      snpSiftJar: await fileExists(snpSift) ? snpSift : null,
      dataDir: config.externalDataDir,
      suiteVersion: null,
      suiteArchiveSha256: null,
      database: {
        id: genome,
        suiteVersion: null,
        databaseSeries: null,
        archiveSha256: null,
        source: 'external',
      },
    };
  }

  async function captureSnpSiftRuntime(preferExternal = false): Promise<SnpEffRuntimeSnapshot> {
    await init();
    await refresh();
    const active = status?.active;
    if (active && !preferExternal) {
      return {
        source: 'managed',
        snpEffJar: active.components.snpEff.path,
        snpSiftJar: active.components.snpSift.path,
        dataDir: status!.dataDir,
        suiteVersion: active.version,
        suiteArchiveSha256: active.archiveSha256,
        database: null,
      };
    }
    const jar = config.externalJarPath;
    if (!jar || !await fileExists(jar)) {
      throw new Error('Install the verified SnpEff + SnpSift suite first.');
    }
    const snpSift = siblingJar(jar, 'SnpSift.jar');
    if (!await fileExists(snpSift)) {
      throw new Error('SnpSift.jar is missing beside the selected external snpEff.jar.');
    }
    return {
      source: 'external',
      snpEffJar: jar,
      snpSiftJar: snpSift,
      dataDir: config.externalDataDir,
      suiteVersion: null,
      suiteArchiveSha256: null,
      database: null,
    };
  }

  return {
    get config() { return config; },
    get loaded() { return loaded; },
    get loading() { return loading; },
    get error() { return error; },
    get status() { return status; },
    get active() { return status?.active ?? null; },
    get catalog() { return status?.catalog ?? null; },
    get databases() { return status?.databases ?? []; },
    get lastUsed() { return config.lastUsed; },
    get jvmHeap() { return config.jvmHeap; },
    init,
    refresh,
    save,
    installSuite,
    installDatabase,
    removeSuite,
    removeDatabase,
    cancelSuiteInstall: () => cancel(SUITE_PROGRESS_KEY),
    cancelDatabaseInstall: (entry: LiatirSnpEffDatabaseCatalogEntry) =>
      cancel(databaseKey(entry.id, entry.suiteVersion)),
    suiteProgress: () => progress.get(SUITE_PROGRESS_KEY) ?? idleProgress(),
    databaseProgress: (entry: LiatirSnpEffDatabaseCatalogEntry) =>
      progress.get(databaseKey(entry.id, entry.suiteVersion)) ?? idleProgress(),
    installedDatabaseFor(entry: LiatirSnpEffDatabaseCatalogEntry) {
      return status?.databases.find((item) =>
        item.id === entry.id
        && item.suiteVersion === entry.suiteVersion
        && item.archiveSha256 === entry.archive.sha256
      ) ?? null;
    },
    async setJvmHeap(heap: string) {
      config = { ...config, jvmHeap: heap };
      await save();
    },
    setExternalJarPath,
    setExternalDataDir,
    touchGenome,
    checkExternalGenomePresent,
    captureSnpEffRuntime,
    captureSnpSiftRuntime,
  };
}

export const snpEffStore = createSnpEffStore();
