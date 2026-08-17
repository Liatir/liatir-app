#!/usr/bin/env node

/**
 * Gate 7 local macOS lifecycle proof.
 *
 * It copies the app into a temporary Applications directory, then proves the
 * data lifecycle in two native WebDriver processes. Package signing and DMG
 * inspection are intentionally a separate gate because re-signing the debug
 * WebDriver bundle changes its launch behavior on macOS.
 */

import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const RUNNER = join(ROOT, 'tests', 'e2e', 'run-tauri-e2e.mjs');
const INSTALL_SPEC = join(ROOT, 'tests', 'e2e', 'specs', 'desktop-beta-macos-install.e2e.mjs');
const RECOVER_SPEC = join(ROOT, 'tests', 'e2e', 'specs', 'desktop-beta-macos-recover.e2e.mjs');
const SOURCE_APP = join(ROOT, 'src-tauri', 'target', 'debug', 'bundle', 'macos', 'Liatir.app');
const TEST_BINARY = join(SOURCE_APP, 'Contents', 'MacOS', 'liatir');

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('The local Gate 7 macOS proof requires macOS arm64');
}

function run(command, args, environment = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: environment,
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (status, signal) => {
      if (status === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${status ?? signal}`));
    });
  });
}

async function runSpec(spec, environment) {
  await run(process.execPath, [RUNNER, spec], { ...process.env, ...environment });
}

async function seedLegacyState(home) {
  const dataRoot = join(home, 'Library', 'Application Support', 'app.liatir.app', '.liatir', '.main', 'data');
  await mkdir(join(dataRoot, 'Results'), { recursive: true });
  await writeFile(join(dataRoot, 'workspaces.json'), `${JSON.stringify({
    workspaces: [{
      id: 'gate7-migrated',
      name: 'Gate 7 Migrated Workspace',
      createdAt: 1_786_659_200_000,
      lastOpenedAt: 1_786_659_200_000,
    }],
  }, null, 2)}\n`);
  await writeFile(join(dataRoot, 'active-workspace.json'), '{"id":"gate7-migrated"}\n');
  await writeFile(join(dataRoot, 'Results', 'gate7-preserved.txt'), 'preserve this scientific result\n');
  return dataRoot;
}

async function assertFile(path, expected) {
  const contents = await readFile(path, 'utf8');
  if (contents !== expected) throw new Error(`Unexpected retained data at ${path}`);
}

try {
  await stat(SOURCE_APP);
} catch {
  throw new Error('The packaged Tauri test app is missing. Run npm run test:tauri:prepare first.');
}

const temporary = await mkdtemp(join(tmpdir(), 'liatir-gate7-macos-'));
const home = join(temporary, 'home');
const installedApp = join(temporary, 'Applications', 'Liatir.app');
const installedBinary = join(installedApp, 'Contents', 'MacOS', 'liatir');
let dataRoot;

try {
  await mkdir(dirname(installedApp), { recursive: true });
  await cp(SOURCE_APP, installedApp, { recursive: true, force: false });
  await stat(installedBinary);
  dataRoot = await seedLegacyState(home);

  const environment = {
    LIATIR_DESKTOP_BETA_LIFECYCLE: '1',
    LIATIR_E2E_TEST_HOME_OVERRIDE: home,
    LIATIR_TAURI_APP: TEST_BINARY,
  };
  await runSpec(INSTALL_SPEC, environment);
  await runSpec(RECOVER_SPEC, environment);

  const appRoot = join(dirname(dataRoot), '_app');
  await assertFile(join(dataRoot, 'Results', 'gate7-preserved.txt'), 'preserve this scientific result\n');
  await assertFile(join(dataRoot, 'Results', 'gate7-created.txt'), 'created after migration\n');
  await stat(join(appRoot, '.migrated'));
  await stat(join(appRoot, 'gate7-recovery.json'));

  // Uninstall only the temporary app bundle, then prove that app-managed state
  // and scientific Results remain available for recovery/reinstallation.
  await rm(installedApp, { recursive: true, force: false });
  try {
    await stat(installedApp);
    throw new Error('The temporary application bundle still exists after uninstall');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await stat(join(appRoot, 'gate7-recovery.json'));
  await assertFile(join(dataRoot, 'Results', 'gate7-created.txt'), 'created after migration\n');

  console.log('Gate 7 macOS lifecycle passed: app copy, migration, restart recovery, uninstall retention.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
