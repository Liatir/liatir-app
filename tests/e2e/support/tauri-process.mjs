import path from 'node:path';

/** Returns an isolated native app environment for the current desktop platform. */
export function tauriTestEnvironment(testHome, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path;
  const environment = {
    HOME: testHome,
    XDG_DATA_HOME: paths.join(testHome, '.local', 'share'),
    XDG_CACHE_HOME: paths.join(testHome, '.cache'),
    XDG_CONFIG_HOME: paths.join(testHome, '.config'),
  };
  if (platform !== 'win32') return environment;
  return {
    ...environment,
    USERPROFILE: testHome,
    APPDATA: paths.join(testHome, 'AppData', 'Roaming'),
    LOCALAPPDATA: paths.join(testHome, 'AppData', 'Local'),
  };
}
