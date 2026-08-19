#!/usr/bin/env node

/**
 * Gate 7 local Linux lifecycle proof.
 *
 * The app is copied into a temporary directory shaped like the `/usr/bin` location the Debian and
 * RPM packages install into, and both native processes drive that installed copy. Building and
 * inspecting the real Linux packages is a separate gate, for the same reason as on Windows: they
 * package the release binary, which has no embedded WebDriver.
 */

import { join, resolve } from 'node:path';
import { runDesktopBetaLifecycle } from './desktop-beta-lifecycle.mjs';

const ROOT = resolve(import.meta.dirname, '..');

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('The local Gate 7 Linux proof requires Linux x86_64');
}

await runDesktopBetaLifecycle({
  label: 'Linux',
  tempPrefix: 'liatir-gate7-linux-',
  sourceApp: join(ROOT, 'src-tauri', 'target', 'debug', 'liatir'),
  installedApp: (temporary) => join(temporary, 'usr', 'bin', 'liatir'),
  // Tauri resolves the Linux application data directory under XDG_DATA_HOME, which the E2E runner
  // points at the isolated test home.
  legacyDataRoot: (home) => join(home, '.local', 'share', 'app.liatir.app', '.liatir', '.main', 'data'),
  installSpec: join(ROOT, 'tests', 'e2e', 'specs', 'desktop-beta-linux-install.e2e.mjs'),
  recoverSpec: join(ROOT, 'tests', 'e2e', 'specs', 'desktop-beta-linux-recover.e2e.mjs'),
});
