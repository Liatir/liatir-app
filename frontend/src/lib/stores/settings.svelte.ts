import { liatir } from '$lib/api';

export type ThemePreference = 'light' | 'dark' | 'system';
/** The preference with 'system' already resolved against the OS. */
export type ResolvedTheme = 'light' | 'dark';

interface LiatirSettings {
  javaPath: string;
  theme: ThemePreference;
  /** Ask the release feed once at startup whether a newer Liatir exists. */
  checkUpdatesAtStartup: boolean;
  /** The one version whose startup notice the user chose not to see again. */
  skippedUpdateVersion: string | null;
}

const SETTINGS_FILE = 'liatir-settings.json';
// localStorage mirror so app.html can apply the theme synchronously at boot,
// before the (async) settings file is read.
const THEME_STORAGE_KEY = 'liatir-theme';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

// The boot script in app.html already stamped data-theme before first paint.
// Seeding from it keeps consumers correct on their very first read, instead of
// starting on 'light' and forcing a redraw once init() runs.
function themeFromDocument(): ResolvedTheme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function createSettingsStore() {
  let javaPath = $state('');
  let theme = $state<ThemePreference>('system');
  let checkUpdatesAtStartup = $state(true);
  let skippedUpdateVersion = $state<string | null>(null);
  let resolvedTheme = $state<ResolvedTheme>(themeFromDocument());
  let loaded = $state(false);
  let dataPaths = $state<{ data: string; cache: string } | null>(null);
  let themeInitialized = false;

  // Resolves 'system' against the OS preference and stamps data-theme on <html>.
  // `resolvedTheme` is the reactive signal third-party surfaces (Plotly, xyflow,
  // CodeMirror, JBrowse) read to re-render themselves — CSS variables alone
  // cannot reach them.
  function applyTheme() {
    if (typeof document === 'undefined') return;
    resolvedTheme =
      theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
    document.documentElement.dataset.theme = resolvedTheme;
  }

  // Restores the theme from the localStorage mirror and tracks OS changes.
  function initTheme() {
    if (themeInitialized || typeof window === 'undefined') return;
    themeInitialized = true;
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemePreference(stored)) theme = stored;
    } catch {
      // localStorage unavailable — keep the default
    }
    applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (theme === 'system') applyTheme();
    });
  }

  async function init() {
    if (loaded) return;
    initTheme();
    const api = liatir();
    if (!api) return;
    const p = await api.invoke('lia_fs_paths') as { data: string; cache: string };
    dataPaths = p;
    try {
      const raw = await api.invoke('lia_read_file_text', { path: `${p.data}/${SETTINGS_FILE}` }) as string;
      const parsed = JSON.parse(raw) as Partial<LiatirSettings>;
      javaPath = parsed.javaPath ?? '';
      checkUpdatesAtStartup = parsed.checkUpdatesAtStartup ?? true;
      skippedUpdateVersion = parsed.skippedUpdateVersion ?? null;
      if (isThemePreference(parsed.theme)) {
        theme = parsed.theme;
        applyTheme();
        mirrorTheme();
      }
    } catch {
      // file doesn't exist yet — use defaults
    }
    loaded = true;
  }

  function mirrorTheme() {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable — boot mirror simply won't apply
    }
  }

  async function save() {
    const api = liatir();
    if (!api || !dataPaths) return;
    const s: LiatirSettings = { javaPath, theme, checkUpdatesAtStartup, skippedUpdateVersion };
    await api.invoke('lia_write_file_path', {
      path: `${dataPaths.data}/${SETTINGS_FILE}`,
      content: JSON.stringify(s, null, 2),
    } as any);
  }

  async function setJavaPath(value: string) {
    javaPath = value.trim();
    await save();
  }

  async function setTheme(value: ThemePreference) {
    theme = value;
    applyTheme();
    mirrorTheme();
    await save();
  }

  async function setCheckUpdatesAtStartup(value: boolean) {
    checkUpdatesAtStartup = value;
    await save();
  }

  async function skipUpdateVersion(version: string) {
    skippedUpdateVersion = version;
    await save();
  }

  return {
    get javaPath() { return javaPath; },
    get theme() { return theme; },
    get checkUpdatesAtStartup() { return checkUpdatesAtStartup; },
    get skippedUpdateVersion() { return skippedUpdateVersion; },
    get resolvedTheme() { return resolvedTheme; },
    get dataPaths() { return dataPaths; },
    get loaded() { return loaded; },
    init,
    setJavaPath,
    setTheme,
    setCheckUpdatesAtStartup,
    skipUpdateVersion,
  };
}

export const settingsStore = createSettingsStore();
