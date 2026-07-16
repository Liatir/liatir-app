/**
 * Builds the app binary used by the end-to-end tests.
 *
 * WebDriver needs permissions the shipping app must never grant, so they are injected into the
 * Tauri capability files only for the duration of this build and reverted immediately afterwards.
 * The revert runs in a `finally`, so an interrupted or failed build cannot leave test permissions
 * behind in the working tree — where they might later be committed, or worse, released.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcTauriDir = path.join(rootDir, 'src-tauri');
/** WebDriver automation permissions — test-only, never shipped. */
const testPermissions = ['wdio:default', 'wdio-webdriver:default'];
const capabilityFiles = [
  path.join(srcTauriDir, 'capabilities', 'local.json'),
  path.join(srcTauriDir, 'capabilities', 'local-dev.json'),
];

// Tuned for CI: capped parallelism to stay inside the runner's memory, and no incremental
// artefacts or debug symbols, which cost time and disk for a binary that is only driven by tests.
// Each is overridable, so a developer running this locally can restore the faster settings.
const env = {
  ...process.env,
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '2',
  CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0'
};

/** Original file contents, keyed by path, so the patch can be undone exactly. */
const originals = new Map();

/** Adds the WebDriver permissions to one capability file, preserving everything already there. */
function patchCapability(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  originals.set(filePath, original);

  const capability = JSON.parse(original);
  const permissions = Array.isArray(capability.permissions) ? capability.permissions : [];
  const nextPermissions = [...permissions];
  // Slot them in right after the app's own bridge permission (or at the end if it is absent), so
  // the resulting file stays readable rather than having test entries scattered through it.
  const insertAfter = nextPermissions.indexOf('liatir-bridge');
  const insertAt = insertAfter >= 0 ? insertAfter + 1 : nextPermissions.length;

  // Reversed because each splice at the same index pushes the previous one right; iterating
  // backwards therefore leaves them in their original order.
  for (const permission of [...testPermissions].reverse()) {
    if (!nextPermissions.includes(permission)) {
      nextPermissions.splice(insertAt, 0, permission);
    }
  }

  capability.permissions = nextPermissions;
  fs.writeFileSync(filePath, `${JSON.stringify(capability, null, 2)}\n`);
}

function restoreCapabilities() {
  for (const [filePath, original] of originals) {
    fs.writeFileSync(filePath, original);
  }
}

// Defaults to failure: only an explicit successful cargo status can change it.
let exitCode = 1;

try {
  for (const filePath of capabilityFiles) {
    patchCapability(filePath);
  }

  // `--debug` keeps the build fast (tests do not need release optimisation), `--features wdio`
  // compiles in the WebDriver hooks, and `--ci` keeps cargo-tauri non-interactive.
  const result = spawnSync(
    'cargo',
    [
      'tauri', 'build', '--debug', '--features', 'wdio',
      ...(process.platform === 'darwin' ? ['--bundles', 'app'] : ['--no-bundle']),
      '--ci'
    ],
    {
      cwd: srcTauriDir,
      env,
      stdio: 'inherit'
    }
  );

  exitCode = result.status ?? 1;
} finally {
  // Runs even if the build threw or was interrupted — see the note at the top of the file.
  restoreCapabilities();
}

process.exit(exitCode);
