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
  // `R` and `L` instead of `AppData\Roaming` and `AppData\Local`. The app reads both only through
  // these variables, so the conventional names buy nothing here and cost fourteen characters of the
  // 260-character MAX_PATH budget that the installed box's own tree has to fit inside. Isolation is
  // unchanged: they are still per-run directories under the test home, and both are created.
  return {
    ...environment,
    USERPROFILE: testHome,
    APPDATA: paths.join(testHome, 'R'),
    LOCALAPPDATA: paths.join(testHome, 'L'),
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

