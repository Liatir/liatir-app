#!/usr/bin/env node

/**
 * Gate 7 local Windows lifecycle proof.
 *
 * The app is copied into a temporary directory shaped like the per-user program directory the NSIS
 * installer uses, and both native processes drive that installed copy. Building and inspecting the
 * real NSIS installer is deliberately a separate gate: it packages the release binary, which has no
 * embedded WebDriver and therefore cannot be driven by these tests.
 */

import { join, resolve } from 'node:path';
import { runDesktopBetaLifecycle } from './desktop-beta-lifecycle.mjs';

const ROOT = resolve(import.meta.dirname, '..');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The local Gate 7 Windows proof requires Windows x86_64');
}

await runDesktopBetaLifecycle({
  label: 'Windows',
  tempPrefix: 'lt-g7w-',
  sourceApp: join(ROOT, 'src-tauri', 'target', 'debug', 'liatir.exe'),
  installedApp: (temporary) => join(temporary, 'Programs', 'Liatir', 'Liatir.exe'),
  legacyDataRoot: (home) => join(home, 'AppData', 'Roaming', 'app.liatir.app', '.liatir', '.main', 'data'),
  installSpec: join(ROOT, 'tests', 'e2e', 'specs', 'desktop-beta-windows-install.e2e.mjs'),
  recoverSpec: join(ROOT, 'tests', 'e2e', 'specs', 'desktop-beta-windows-recover.e2e.mjs'),
});
