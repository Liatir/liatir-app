#!/usr/bin/env node

/**
 * Build and inspect a local Windows release-shaped NSIS installer without release secrets.
 *
 * Windows has no ad-hoc code signature, so the separation from a public artifact is the opposite of
 * the macOS gate's: this script asserts that the installer and the packaged executable are
 * *unsigned*, and refuses to continue if either one carries an Authenticode signature. Updater
 * artifact generation is disabled for the same reason.
 *
 * The payload is verified the way the macOS gate mounts its DMG: the real installer performs a
 * silent per-user installation into a test-owned directory, the packaged executable and uninstaller
 * are checked there, and the generated uninstaller then removes it again. Nothing is installed into
 * the machine's normal program locations, and no WebView2 runtime installation is attempted.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localNodeCliInvocation, npmInvocation } from './node-cli.mjs';
import { confShellInvocation } from './run-conf.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONFIG_FILES = [
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
  'src-tauri/capabilities/local.json',
  'src-tauri/window.env',
  'src-ts/bridge.constants.json',
];
const APP_VERSION = '0.2.1';
/** The NSIS first-header magic; present uncompressed in every Nullsoft installer. */
const NSIS_MAGIC = 'NullsoftInst';

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: environment,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
}

function runNpm(args) {
  const invocation = npmInvocation(args);
  run(invocation.command, invocation.args);
}

function powershell(script) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { cwd: ROOT, encoding: 'utf8', shell: false },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`powershell exited with ${result.status}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Authenticode status of one file, as PowerShell reports it. */
function signatureStatus(path) {
  // Single quotes, not JSON: a PowerShell double-quoted string keeps backslashes literal, so the
  // escaped path JSON produces would not be the path at all.
  const literal = `'${path.replaceAll("'", "''")}'`;
  return powershell(`(Get-AuthenticodeSignature -LiteralPath ${literal}).Status`);
}

function requireUnsigned(path, label) {
  const status = signatureStatus(path);
  if (status !== 'NotSigned') {
    throw new Error(
      `${label} reports Authenticode status ${status}. This gate produces local, explicitly `
      + 'unsigned artifacts; a signed package must be built by the release contract instead.',
    );
  }
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * NSIS uninstallers copy themselves into the temporary directory and return immediately, so the
 * only observable completion signal is the install directory disappearing. One bounded wait.
 */
function waitForRemoval(path, timeoutMs = 120_000) {
  const idle = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!exists(path)) return;
    Atomics.wait(idle, 0, 0, 500);
  }
  throw new Error(`The silent uninstall did not remove ${path}`);
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The local Windows package gate requires Windows x86_64');
}

const originals = new Map(CONFIG_FILES.map((relative) => {
  const path = join(ROOT, relative);
  return [path, readFileSync(path)];
}));
// Short root: the installed tree is checked inside it and Windows enforces MAX_PATH.
const temporary = mkdtempSync(join(tmpdir(), 'lt-g7p-'));
const installDir = join(temporary, 'Liatir');

try {
  runNpm(['run', 'gen:sdk-types']);
  runNpm(['run', 'build:frontend']);
  runNpm(['run', 'ts:compile']);
  // Verifies the linux-64 archive is present; Windows cannot build it, and an
  // installer without it would ship an application with no tools at all.
  runNpm(['run', 'native-tools:require']);

  const prodConf = confShellInvocation('prod-conf.sh');
  run(prodConf.command, prodConf.args, {
    ...process.env,
    APP_VERSION,
    CARGO_PACKAGE_VERSION: APP_VERSION,
    UPDATE_ENDPOINT: 'https://updates.invalid/{{target}}/{{arch}}/{{current_version}}',
    ED25519_PUBKEY: 'local-package-gate-placeholder',
    MAIN_WINDOW_URL: '',
  });

  const configPath = join(ROOT, 'src-tauri', 'tauri.conf.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.bundle.targets = ['nsis'];
  config.bundle.createUpdaterArtifacts = false;
  config.bundle.windows = {
    ...(config.bundle.windows ?? {}),
    // A local gate must never install a system-wide runtime as a side effect.
    webviewInstallMode: { type: 'skip' },
  };
  delete config.bundle.windows.certificateThumbprint;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const tauri = localNodeCliInvocation('@tauri-apps/cli/tauri.js', [
    'build', '--bundles', 'nsis', '--ci',
  ]);
  run(tauri.command, tauri.args, {
    ...process.env,
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '2',
    CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0',
  });

  const releaseDir = join(ROOT, 'src-tauri', 'target', 'release');
  const nsisDir = join(releaseDir, 'bundle', 'nsis');
  const setupName = readdirSync(nsisDir).find((name) => name.endsWith('-setup.exe'));
  if (!setupName) throw new Error(`No NSIS installer was produced under ${nsisDir}`);
  if (!setupName.includes(APP_VERSION) || !setupName.includes('x64')) {
    throw new Error(`The NSIS installer does not identify this version and architecture: ${setupName}`);
  }
  const setup = join(nsisDir, setupName);
  const packagedExecutable = join(releaseDir, 'liatir.exe');
  statSync(packagedExecutable);

  const installerBytes = readFileSync(setup);
  if (installerBytes.subarray(0, 2).toString('latin1') !== 'MZ') {
    throw new Error(`${setupName} is not a Windows executable image`);
  }
  if (!installerBytes.includes(NSIS_MAGIC)) {
    throw new Error(`${setupName} does not carry the NSIS installer signature`);
  }
  requireUnsigned(setup, setupName);
  requireUnsigned(packagedExecutable, 'The packaged application executable');

  // `/D` sets $INSTDIR and must stay the last, unquoted argument.
  run(setup, ['/S', `/D=${installDir}`]);
  const installedApp = join(installDir, 'Liatir.exe');
  const uninstaller = join(installDir, 'uninstall.exe');
  statSync(installedApp);
  statSync(uninstaller);
  requireUnsigned(installedApp, 'The installed application executable');

  run(uninstaller, ['/S']);
  waitForRemoval(installDir);

  console.log(`Gate 7 local Windows package passed: ${setup}`);
  console.log('It installed to a test-owned directory and its own uninstaller removed it again.');
  console.log('This artifact is unsigned and not a release; it must not be published.');
} finally {
  // A failure between install and uninstall would otherwise leave this user's registry entry and
  // Start Menu shortcut behind. The product's own uninstaller is what knows how to remove them.
  if (exists(join(installDir, 'uninstall.exe'))) {
    spawnSync(join(installDir, 'uninstall.exe'), ['/S'], { shell: false, stdio: 'inherit' });
    try {
      waitForRemoval(installDir, 60_000);
    } catch (error) {
      console.error(`Leftover local installation at ${installDir}: ${error.message}`);
    }
  }
  for (const [path, contents] of originals) writeFileSync(path, contents);
  rmSync(temporary, { recursive: true, force: true });
}
