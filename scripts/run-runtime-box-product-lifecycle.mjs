#!/usr/bin/env node

/** Runs the signed candidate registry and real product lifecycle in one bounded process tree. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runtimeBoxNpmInvocation } from './runtime-box/npm.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE_DIR = path.join(ROOT, '.runtime-box-ci');
const REGISTRY_LOG = path.join(STATE_DIR, 'candidate-registry.log');
const REGISTRY_PORT = Number(process.env.LIATIR_RUNTIME_BOX_CANDIDATE_PORT ?? 8790);
const REGISTRY_HEALTH_URL = `http://127.0.0.1:${REGISTRY_PORT}/health`;

/** Waits only for local readiness and fails immediately if the registry exits. */
async function waitForRegistry(child) {
  let lastError = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Candidate registry exited before readiness with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(REGISTRY_HEALTH_URL);
      if (response.ok) return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Candidate registry did not become ready: ${lastError?.message ?? 'unknown error'}`);
}

/** Runs the repository-owned native product test and forwards its compact output. */
async function runProductLifecycle() {
  const invocation = runtimeBoxNpmInvocation([
    'run', 'test:tauri:run', '--', '--heavy',
    'tests/e2e/specs/runtime-box-native.e2e.mjs',
  ]);
  await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Product lifecycle terminated by ${signal}.`));
      else if (code !== 0) reject(new Error(`Product lifecycle exited with code ${code}.`));
      else resolve();
    });
  });
}

/** Stops the direct Node registry child without leaving an orphan command wrapper. */
async function stopRegistry(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

fs.mkdirSync(STATE_DIR, { recursive: true });
const registryLog = fs.createWriteStream(REGISTRY_LOG, { flags: 'a' });
const registry = spawn(
  process.execPath,
  ['scripts/runtime-box.mjs', 'serve', '--port', String(REGISTRY_PORT)],
  {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);
registry.stdout.pipe(registryLog, { end: false });
registry.stderr.pipe(registryLog, { end: false });

let failure = null;
try {
  await waitForRegistry(registry);
  await runProductLifecycle();
} catch (error) {
  failure = error;
} finally {
  await stopRegistry(registry);
  await new Promise((resolve) => registryLog.end(resolve));
}

if (failure) {
  const log = fs.readFileSync(REGISTRY_LOG);
  const tail = log.subarray(Math.max(0, log.length - 12 * 1024)).toString('utf8').trim();
  if (tail) console.error(`Candidate registry log tail (last 12 KiB):\n${tail}`);
  throw failure;
}
