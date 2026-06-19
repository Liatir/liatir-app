import { liatir } from '$lib/api';

interface LiatirSettings {
  javaPath: string;
}

const SETTINGS_FILE = 'liatir-settings.json';

function createSettingsStore() {
  let javaPath = $state('');
  let loaded = $state(false);
  let dataPaths = $state<{ data: string; cache: string } | null>(null);

  async function init() {
    if (loaded) return;
    const api = liatir();
    if (!api) return;
    const p = await api.invoke('lia_fs_paths') as { data: string; cache: string };
    dataPaths = p;
    try {
      const raw = await api.invoke('lia_read_file_text', { path: `${p.data}/${SETTINGS_FILE}` }) as string;
      const parsed = JSON.parse(raw) as Partial<LiatirSettings>;
      javaPath = parsed.javaPath ?? '';
    } catch {
      // file doesn't exist yet — use defaults
    }
    loaded = true;
  }

  async function save() {
    const api = liatir();
    if (!api || !dataPaths) return;
    const s: LiatirSettings = { javaPath };
    await api.invoke('lia_write_file_path', {
      path: `${dataPaths.data}/${SETTINGS_FILE}`,
      content: JSON.stringify(s, null, 2),
    } as any);
  }

  async function setJavaPath(value: string) {
    javaPath = value.trim();
    await save();
  }

  return {
    get javaPath() { return javaPath; },
    get dataPaths() { return dataPaths; },
    get loaded() { return loaded; },
    init,
    setJavaPath,
  };
}

export const settingsStore = createSettingsStore();
