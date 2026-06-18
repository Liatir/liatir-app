import { liatir } from '$lib/api';

export interface SnpEffConfig {
  jarPath: string | null;
  dataDir: string;
  downloadedGenomes: string[];
}

const CONFIG_FILENAME = 'snpeff-config.json';

function createSnpEffStore() {
  let config = $state<SnpEffConfig>({
    jarPath: null,
    dataDir: '',
    downloadedGenomes: [],
  });
  let loaded = $state(false);
  // Tracks an in-progress genome download across page navigations (in-memory only)
  let activeDownload = $state<string | null>(null);

  async function init() {
    const api = liatir();
    if (!api || loaded) return;

    const { data } = await api.invoke('lia_fs_paths') as { data: string; cache: string };
    const defaultDataDir = `${data}/snpeff-data`;
    const configPath = `${data}/${CONFIG_FILENAME}`;

    try {
      const raw = await api.invoke('lia_read_file_text', { path: configPath }) as string;
      const parsed = JSON.parse(raw) as Partial<SnpEffConfig>;
      config = {
        jarPath: parsed.jarPath ?? null,
        dataDir: parsed.dataDir ?? defaultDataDir,
        downloadedGenomes: parsed.downloadedGenomes ?? [],
      };
    } catch {
      config = { jarPath: null, dataDir: defaultDataDir, downloadedGenomes: [] };
    }

    loaded = true;
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

  async function setJarPath(path: string | null) {
    config = { ...config, jarPath: path };
    await save();
  }

  async function markGenomeDownloaded(genome: string) {
    if (!config.downloadedGenomes.includes(genome)) {
      config = { ...config, downloadedGenomes: [...config.downloadedGenomes, genome] };
      await save();
    }
  }

  async function removeGenome(genome: string) {
    config = { ...config, downloadedGenomes: config.downloadedGenomes.filter(g => g !== genome) };
    await save();
  }

  async function checkGenomePresent(genome: string): Promise<boolean> {
    const api = liatir();
    if (!api || !config.dataDir) return false;
    const markerPath = `${config.dataDir}/${genome}/snpEffectPredictor.bin`;
    try {
      await api.invoke('lia_file_size', { path: markerPath });
      return true;
    } catch {
      return false;
    }
  }

  return {
    get config() { return config; },
    get loaded() { return loaded; },
    get activeDownload() { return activeDownload; },
    init,
    save,
    setJarPath,
    markGenomeDownloaded,
    removeGenome,
    checkGenomePresent,
    startDownload(genome: string) { activeDownload = genome; },
    finishDownload() { activeDownload = null; },
  };
}

export const snpEffStore = createSnpEffStore();
