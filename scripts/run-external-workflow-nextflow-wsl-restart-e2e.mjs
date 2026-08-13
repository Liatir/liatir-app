#!/usr/bin/env node

/** Proves native Windows app restart cleanup for one real WSL2 Nextflow run. */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const RUNNER = join(ROOT, 'tests', 'e2e', 'run-tauri-e2e.mjs');
const START_SPEC = join(ROOT, 'tests', 'e2e', 'specs', 'external-workflow-nextflow-restart-start.e2e.mjs');
const RECOVER_SPEC = join(ROOT, 'tests', 'e2e', 'specs', 'external-workflow-nextflow-restart-recover.e2e.mjs');

if (process.platform !== 'win32') {
  throw new Error('The Windows-to-WSL2 restart proof must run on native Windows.');
}

function runSpec(specPath, environment) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [RUNNER, specPath], {
      cwd: ROOT,
      env: { ...process.env, ...environment },
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (status, signal) => {
      if (status === 0) resolvePromise();
      else reject(new Error(`${specPath} exited with ${status ?? signal}`));
    });
  });
}

async function combineReports(outputPath, paths) {
  if (!outputPath) return;
  const reports = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
  const tests = reports.flatMap((report) => report.tests);
  const startedAt = reports[0].startedAt;
  const finishedAt = reports.at(-1).finishedAt;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    appLogPaths: reports.map((report) => report.appLogPath),
    artifactsDir: reports[0].artifactsDir,
    heavy: false,
    specs: reports.flatMap((report) => report.specs),
    startedAt,
    finishedAt,
    summary: {
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      failed: tests.filter((test) => test.status === 'failed').length,
      passed: tests.filter((test) => test.status === 'passed').length,
      skipped: tests.filter((test) => test.status === 'skipped').length,
      total: tests.length,
    },
    tests,
    visual: false,
  }, null, 2)}\n`);
}

const temporary = await mkdtemp(join(tmpdir(), 'liatir-nextflow-wsl-restart-'));
const sharedHome = join(temporary, 'home');
const statePath = join(temporary, 'restart-state.json');
const phaseReports = [join(temporary, 'phase-start.json'), join(temporary, 'phase-recover.json')];
try {
  const commonEnvironment = {
    LIATIR_E2E_NEXTFLOW: '1',
    LIATIR_E2E_NEXTFLOW_WINDOWS_WSL_RESTART: '1',
    LIATIR_E2E_TEST_HOME_OVERRIDE: sharedHome,
    LIATIR_NEXTFLOW_RESTART_STATE: statePath,
  };
  let runError = null;
  try {
    await runSpec(START_SPEC, { ...commonEnvironment, LIATIR_E2E_REPORT: phaseReports[0] });
    await runSpec(RECOVER_SPEC, { ...commonEnvironment, LIATIR_E2E_REPORT: phaseReports[1] });
  } catch (error) {
    runError = error;
  }
  const reports = [];
  for (const reportPath of phaseReports) {
    try {
      await readFile(reportPath);
      reports.push(reportPath);
    } catch {
      // A phase that fails before native harness startup has no report.
    }
  }
  if (reports.length > 0) await combineReports(process.env.LIATIR_E2E_REPORT, reports);
  if (runError) throw runError;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
