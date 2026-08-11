#!/usr/bin/env node

/** Proves interrupted pipeline recovery across two separate native app processes. */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const RUNNER = join(ROOT, 'tests', 'e2e', 'run-tauri-e2e.mjs');
const START_SPEC = join(ROOT, 'tests', 'e2e', 'specs', 'pipeline-settlement-restart-start.e2e.mjs');
const RECOVER_SPEC = join(ROOT, 'tests', 'e2e', 'specs', 'pipeline-settlement-restart-recover.e2e.mjs');

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

async function readableReports(paths) {
  const readable = [];
  for (const path of paths) {
    try {
      await readFile(path);
      readable.push(path);
    } catch {
      // A phase that failed before the native harness started has no report.
    }
  }
  return readable;
}

async function startPendingApi() {
  const server = createServer((request, response) => {
    request.once('close', () => response.destroy());
    // Intentionally never acknowledge the request: the first native app must
    // be terminated with a genuinely unsettled pipeline step.
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Restart fixture API did not expose a TCP port.');
  return {
    url: `http://127.0.0.1:${address.port}/pending`,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      });
    },
  };
}

const temporary = await mkdtemp(join(tmpdir(), 'liatir-pipeline-restart-'));
const sharedHome = join(temporary, 'home');
const phaseReports = [join(temporary, 'phase-start.json'), join(temporary, 'phase-recover.json')];
let api;
try {
  api = await startPendingApi();
  const commonEnvironment = {
    LIATIR_E2E_TEST_HOME_OVERRIDE: sharedHome,
    LIATIR_PIPELINE_RESTART_API_URL: api.url,
  };
  let runError = null;
  try {
    await runSpec(START_SPEC, { ...commonEnvironment, LIATIR_E2E_REPORT: phaseReports[0] });
    await runSpec(RECOVER_SPEC, { ...commonEnvironment, LIATIR_E2E_REPORT: phaseReports[1] });
  } catch (error) {
    runError = error;
  }
  const reports = await readableReports(phaseReports);
  if (reports.length > 0) await combineReports(process.env.LIATIR_E2E_REPORT, reports);
  if (runError) throw runError;
} finally {
  await api?.close();
  await rm(temporary, { recursive: true, force: true });
}
