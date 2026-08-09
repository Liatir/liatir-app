import fs from 'node:fs';
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
  // `AppData\Roaming` and `AppData\Local` exactly, even though fourteen characters of MAX_PATH
  // budget would be welcome elsewhere. Windows Known Folder resolution does not simply read these
  // variables: it derives the local folder from the roaming one by segment, so a home whose layout
  // does not carry those names resolves to nothing. Shortening them to `R` and `L` made
  // `app_data_dir()` return UnknownPath and the app panicked at `main.rs:142` before WebDriver came
  // up — the same failure a29ee24 fixed, reintroduced from the other side (run 31329290387).
  //
  // The budget is bought by keeping the home itself short instead; see run-tauri-e2e.mjs.
  return {
    ...environment,
    USERPROFILE: testHome,
    APPDATA: paths.join(testHome, 'AppData', 'Roaming'),
    LOCALAPPDATA: paths.join(testHome, 'AppData', 'Local'),
  };
}

/** Creates every directory declared by the isolated native-app environment. */
export function prepareTauriTestEnvironment(
  testHome,
  platform = process.platform,
  createDirectory = (directory) => fs.mkdirSync(directory, { recursive: true }),
) {
  const environment = tauriTestEnvironment(testHome, platform);
  for (const directory of new Set(Object.values(environment))) {
    createDirectory(directory);
  }
  return environment;
}

/**
 * Keeps WebKitGTK off the GPU paths that do not exist under a headless X server.
 *
 * On Linux the suite runs inside `xvfb`, which offers no DRI device, so WebKitGTK's accelerated
 * compositor and DMA-BUF renderer fail to initialise — visible as `failed to create dri2 screen`
 * and `ZINK: failed to choose pdev`. It degrades quietly until the machine is under real load, and
 * then the web process dies. Losing it destroys the `main` window, and `main.rs` lets the app exit
 * once that window is gone, so the app disappears with status 0 and every later WebDriver call
 * fails with a bare `fetch failed`.
 *
 * That is exactly how release run 31290534596 failed: it had already built, signed, validated and
 * published the Geneformer CUDA box, and died while the product extracted the multi-gigabyte
 * archive. Forcing the software path costs nothing here — these tests never assert on rendering.
 *
 * Both variables are honoured only by WebKitGTK, and each is left alone if the operator set it.
 */
export function headlessWebKitEnvironment() {
  if (process.platform !== 'linux') return {};
  return {
    WEBKIT_DISABLE_COMPOSITING_MODE: process.env.WEBKIT_DISABLE_COMPOSITING_MODE ?? '1',
    WEBKIT_DISABLE_DMABUF_RENDERER: process.env.WEBKIT_DISABLE_DMABUF_RENDERER ?? '1',
  };
}

