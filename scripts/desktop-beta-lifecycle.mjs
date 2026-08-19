/**
 * The Gate 7 desktop data lifecycle, shared by the platforms that can drive their installed copy.
 *
 * The proof is always the same: install the app somewhere test-owned, let one native process
 * migrate legacy state, let a second process recover it after restart, then uninstall the
 * application and show that migrated state and both old and new Results are still there. Only the
 * install location and the legacy data root differ per platform, so those are the descriptor.
 *
 * macOS keeps its own orchestrator: it drives the build output rather than the installed copy,
 * because re-signing a debug WebDriver bundle changes how macOS launches it.
 */

import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const RUNNER = join(ROOT, 'tests', 'e2e', 'run-tauri-e2e.mjs');

function run(command, args, environment) {
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

/** Writes the state an older Liatir build would have left in the public data root. */
async function seedLegacyState(dataRoot) {
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
}

async function assertFile(path, expected) {
  const contents = await readFile(path, 'utf8');
  if (contents !== expected) throw new Error(`Unexpected retained data at ${path}`);
}

async function assertAbsent(path, description) {
  try {
    await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(description);
}

export async function runDesktopBetaLifecycle({
  label,
  tempPrefix,
  sourceApp,
  installedApp,
  legacyDataRoot,
  installSpec,
  recoverSpec,
}) {
  try {
    await stat(sourceApp);
  } catch {
    throw new Error('The compiled Tauri test app is missing. Run npm run test:tauri:prepare first.');
  }

  // Short segments on purpose: Windows enforces MAX_PATH for anything that has not opted into long
  // paths, and this proof spends its budget on the isolated application data underneath.
  const temporary = await mkdtemp(join(tmpdir(), tempPrefix));
  const home = join(temporary, 'home');
  const installed = installedApp(temporary);
  const dataRoot = legacyDataRoot(home);

  try {
    await mkdir(dirname(installed), { recursive: true });
    await cp(sourceApp, installed, { recursive: true, force: false });
    await stat(installed);
    await seedLegacyState(dataRoot);

    const environment = {
      ...process.env,
      LIATIR_DESKTOP_BETA_LIFECYCLE: '1',
      LIATIR_E2E_TEST_HOME_OVERRIDE: home,
      LIATIR_TAURI_APP: installed,
    };
    await run(process.execPath, [RUNNER, installSpec], environment);
    await run(process.execPath, [RUNNER, recoverSpec], environment);

    const appRoot = join(dirname(dataRoot), '_app');
    await assertFile(join(dataRoot, 'Results', 'gate7-preserved.txt'), 'preserve this scientific result\n');
    await assertFile(join(dataRoot, 'Results', 'gate7-created.txt'), 'created after migration\n');
    await stat(join(appRoot, '.migrated'));
    await stat(join(appRoot, 'gate7-recovery.json'));

    // Uninstall only the installed application, then prove that app-managed state and scientific
    // Results remain available for recovery or reinstallation.
    const installedRoot = dirname(installed);
    await rm(installedRoot, { recursive: true, force: false });
    await assertAbsent(installedRoot, 'The installed application still exists after uninstall');
    await stat(join(appRoot, 'gate7-recovery.json'));
    await assertFile(join(dataRoot, 'Results', 'gate7-created.txt'), 'created after migration\n');

    console.log(`Gate 7 ${label} lifecycle passed: app install, migration, restart recovery, uninstall retention.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
