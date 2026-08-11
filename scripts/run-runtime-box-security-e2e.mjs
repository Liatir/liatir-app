#!/usr/bin/env node

/** Runs the lightweight Runtime Box anti-replay lifecycle across two native app processes. */

import { createHash, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createDeterministicZip } from 'scrollcase/build';
import { boxTargetAdapter, boxTargetId } from 'scrollcase/contract';
import { generateSigningKey, signDocument } from 'scrollcase/sign';

const ROOT = resolve(import.meta.dirname, '..');
const RUNNER = join(ROOT, 'tests', 'e2e', 'run-tauri-e2e.mjs');
const INSTALL_SPEC = join(ROOT, 'tests', 'e2e', 'specs', 'runtime-box-security-install.e2e.mjs');
const RESTART_SPEC = join(ROOT, 'tests', 'e2e', 'specs', 'runtime-box-security-restart.e2e.mjs');
const BOX_ID = 'security-fixture-box';
const MODEL_ID = 'security-fixture-model';
const RUNTIME_ID = 'security-fixture-runtime';
const execFileAsync = promisify(execFile);

const HOST_TARGETS = new Map([
  ['darwin/arm64', { platform: 'macos', arch: 'aarch64', accelerator: 'cpu' }],
  ['linux/x64', { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' }],
  ['win32/x64', { platform: 'windows', arch: 'x86_64', accelerator: 'cpu' }],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sendJson(response, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  response.writeHead(status, {
    'content-length': String(body.length),
    'content-type': 'application/json',
  });
  response.end(body);
}

function sendBuffer(request, response, body, contentType) {
  const range = /^bytes=(\d+)-$/.exec(String(request.headers.range ?? ''));
  if (range) {
    const start = Number(range[1]);
    if (!Number.isSafeInteger(start) || start >= body.length) {
      response.writeHead(416, { 'content-range': `bytes */${body.length}` });
      response.end();
      return;
    }
    const partial = body.subarray(start);
    response.writeHead(206, {
      'accept-ranges': 'bytes',
      'content-length': String(partial.length),
      'content-range': `bytes ${start}-${body.length - 1}/${body.length}`,
      'content-type': contentType,
    });
    response.end(partial);
    return;
  }
  response.writeHead(200, {
    'accept-ranges': 'bytes',
    'content-length': String(body.length),
    'content-type': contentType,
  });
  response.end(body);
}

function provenance(version) {
  return {
    scrollId: `runtime-box-security-${version}`,
    scrollVersion: version,
    builderRevision: version === '1.0.0' ? '1'.repeat(40) : '2'.repeat(40),
    sourceTreeDirty: false,
    sourceRevision: `security-fixture-${version}`,
    pythonVersion: '3',
    dependencyLockSha256: sha256(`security-fixture-lock-${version}`),
    builtAt: version === '1.0.0' ? '2026-08-10T08:00:00.000Z' : '2026-08-11T08:00:00.000Z',
    pixiVersion: '0.50.0',
  };
}

async function createPythonLauncher(root, payloadDir, target, version) {
  if (target.platform !== 'windows') {
    const launcherPath = join(payloadDir, 'venv', 'bin', 'python');
    await mkdir(dirname(launcherPath), { recursive: true });
    await writeFile(
      launcherPath,
      `#!/bin/sh\nexport LIATIR_SECURITY_FIXTURE_VERSION=${version}\nexec python3 "$@"\n`,
      { mode: 0o755 },
    );
    return 'venv/bin/python';
  }

  // Runtime Boxes execute their declared interpreter directly, so a .cmd shim would not exercise
  // the native Windows product path. Compile one tiny PE launcher with the Rust toolchain already
  // required by the Tauri build; it delegates to the test host's Python and preserves stdio/status.
  const sourcePath = join(root, `security-fixture-launcher-${version}.rs`);
  const launcherPath = join(payloadDir, 'venv', 'python.exe');
  await mkdir(dirname(launcherPath), { recursive: true });
  await writeFile(sourcePath, `
use std::process::{exit, Command};

fn main() {
    let Some(host_python) = std::env::var_os("LIATIR_RUNTIME_BOX_SECURITY_HOST_PYTHON") else {
        eprintln!("LIATIR_RUNTIME_BOX_SECURITY_HOST_PYTHON is not set");
        exit(1);
    };
    match Command::new(host_python)
        .args(std::env::args_os().skip(1))
        .env("LIATIR_SECURITY_FIXTURE_VERSION", ${JSON.stringify(version)})
        .status()
    {
        Ok(status) => exit(status.code().unwrap_or(1)),
        Err(error) => {
            eprintln!("cannot start the Runtime Box security fixture host Python: {error}");
            exit(1);
        }
    }
}
`);
  await execFileAsync('rustc', [
    sourcePath,
    '--crate-name', 'liatir_runtime_box_security_launcher',
    '--edition', '2021',
    '-C', 'opt-level=z',
    '-C', 'strip=symbols',
    '-o', launcherPath,
  ]);
  return 'venv/python.exe';
}

async function createFixtureArchive(root, target, version) {
  const payloadDir = join(root, `payload-${version}`);
  const archivePath = join(root, `security-fixture-${version}.zip`);
  const pythonEntryPoint = await createPythonLauncher(root, payloadDir, target, version);
  const shared = {
    schemaVersion: 2,
    boxId: BOX_ID,
    modelId: MODEL_ID,
    runtimeId: RUNTIME_ID,
    version,
    target,
    pythonEntryPoint,
    modelCacheSubdir: 'model-cache/security-fixture',
    selfTest: { pythonImports: ['json'], timeoutSeconds: 10 },
    provenance: provenance(version),
  };
  await writeFile(join(payloadDir, 'box.json'), `${JSON.stringify(shared, null, 2)}\n`);
  await createDeterministicZip(payloadDir, archivePath, boxTargetAdapter(target));
  const bytes = await readFile(archivePath);
  return {
    archivePath,
    bytes,
    sha256: sha256(bytes),
    sizeBytes: (await stat(archivePath)).size,
    shared,
  };
}

function releasePayload(fixture, baseUrl) {
  return {
    ...fixture.shared,
    kind: 'liatir.runtime-box.release',
    compatibility: {
      minLiatirVersion: '0.0.0',
      hostEnvironments: ['native'],
    },
    archive: {
      format: 'zip',
      url: `${baseUrl}/archives/${fixture.shared.version}.zip`,
      sha256: fixture.sha256,
      sizeBytes: fixture.sizeBytes,
    },
  };
}

function channelPayload({ baseUrl, target, version, updatedAt, cohortSalt }) {
  return {
    schemaVersion: 2,
    kind: 'liatir.runtime-box.channel',
    channel: 'beta',
    boxId: BOX_ID,
    target,
    updatedAt,
    cohortSalt,
    releases: [{
      version,
      releaseManifestUrl: `${baseUrl}/releases/${version}.json`,
      rolloutPercentage: 100,
    }],
  };
}

function revocationsPayload({ target, updatedAt, reason }) {
  return {
    schemaVersion: 2,
    kind: 'liatir.runtime-box.revocations',
    updatedAt,
    revocations: [{
      boxId: BOX_ID,
      version: '0.0.1',
      target,
      reason,
      revokedAt: updatedAt,
    }],
  };
}

async function startRegistry({ root, target, privatePath, publicPath }) {
  const fixtures = new Map([
    ['1.0.0', await createFixtureArchive(root, target, '1.0.0')],
    ['2.0.0', await createFixtureArchive(root, target, '2.0.0')],
  ]);
  const controlToken = randomBytes(24).toString('hex');
  const state = {
    channel: 'a',
    revocations: 'a',
    documents: null,
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'POST' && url.pathname === '/_security-fixture/control') {
        if (request.headers.authorization !== `Bearer ${controlToken}`) {
          sendJson(response, 403, { error: 'forbidden' });
          return;
        }
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const next = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Object.hasOwn(state.documents.channels, next.channel)
          || !Object.hasOwn(state.documents.revocations, next.revocations)) {
          sendJson(response, 400, { error: 'invalid fixture mode' });
          return;
        }
        state.channel = next.channel;
        state.revocations = next.revocations;
        sendJson(response, 200, { channel: state.channel, revocations: state.revocations });
        return;
      }
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'method_not_allowed' });
        return;
      }
      if (url.pathname === `/v1/channels/beta/${BOX_ID}/${boxTargetId(target)}`) {
        sendBuffer(request, response, state.documents.channels[state.channel], 'application/json');
        return;
      }
      if (url.pathname === '/v1/revocations') {
        const document = state.documents.revocations[state.revocations];
        if (document === null) {
          sendJson(response, 404, { error: 'not_found' });
          return;
        }
        sendBuffer(
          request,
          response,
          document,
          'application/json',
        );
        return;
      }
      const release = /^\/v1\/releases\/(1\.0\.0|2\.0\.0)\.json$/.exec(url.pathname);
      if (release) {
        sendBuffer(request, response, state.documents.releases[release[1]], 'application/json');
        return;
      }
      const archive = /^\/v1\/archives\/(1\.0\.0|2\.0\.0)\.zip$/.exec(url.pathname);
      if (archive) {
        sendBuffer(request, response, fixtures.get(archive[1]).bytes, 'application/zip');
        return;
      }
      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture registry has no TCP address.');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const signing = { privatePath, publicPath };
  const releaseA = await signDocument(releasePayload(fixtures.get('1.0.0'), baseUrl), signing);
  const releaseB = await signDocument(releasePayload(fixtures.get('2.0.0'), baseUrl), signing);
  const channelA = channelPayload({
    baseUrl,
    target,
    version: '1.0.0',
    updatedAt: '2026-08-10T10:00:00.000Z',
    cohortSalt: 'security-a',
  });
  const channelB = channelPayload({
    baseUrl,
    target,
    version: '2.0.0',
    updatedAt: '2026-08-11T10:00:00.000Z',
    cohortSalt: 'security-b',
  });
  const channelEquivocalB = { ...channelB, cohortSalt: 'security-b-equivocal' };
  const revocationsA = revocationsPayload({
    target,
    updatedAt: '2026-08-10T11:00:00.000Z',
    reason: 'Non-matching security fixture generation A',
  });
  const revocationsB = revocationsPayload({
    target,
    updatedAt: '2026-08-11T11:00:00.000Z',
    reason: 'Non-matching security fixture generation B',
  });
  const revocationsEquivocalB = revocationsPayload({
    target,
    updatedAt: '2026-08-11T11:00:00.000Z',
    reason: 'Different payload at the same signed revocation generation',
  });
  const encode = (document) => Buffer.from(`${JSON.stringify(document)}\n`, 'utf8');
  state.documents = {
    channels: {
      a: encode(await signDocument(channelA, signing)),
      b: encode(await signDocument(channelB, signing)),
      'equivocal-b': encode(await signDocument(channelEquivocalB, signing)),
    },
    releases: {
      '1.0.0': encode(releaseA),
      '2.0.0': encode(releaseB),
    },
    revocations: {
      a: encode(await signDocument(revocationsA, signing)),
      b: encode(await signDocument(revocationsB, signing)),
      'equivocal-b': encode(await signDocument(revocationsEquivocalB, signing)),
      missing: null,
    },
  };
  return {
    baseUrl,
    controlToken,
    close: () => new Promise((resolvePromise, reject) => {
      server.close((error) => (error ? reject(error) : resolvePromise()));
    }),
  };
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

async function readableReports(paths) {
  const readable = [];
  for (const path of paths) {
    try {
      await readFile(path);
      readable.push(path);
    } catch {
      // A process that failed before the E2E harness started has no report to combine.
    }
  }
  return readable;
}

async function resolveHostPythonExecutable() {
  for (const [command, prefixArgs] of [
    ['python.exe', []],
    ['python3.exe', []],
    ['py.exe', ['-3']],
  ]) {
    try {
      const { stdout } = await execFileAsync(command, [
        ...prefixArgs,
        '-c',
        'import sys; print(sys.executable)',
      ]);
      const executable = stdout.toString('utf8').trim();
      if (executable) return executable;
    } catch {
      // Try the next standard Windows Python entry point.
    }
  }
  throw new Error('Windows Runtime Box security E2E requires an available Python 3 interpreter.');
}

const target = HOST_TARGETS.get(`${process.platform}/${process.arch}`);
if (!target) {
  console.log(`Runtime Box security E2E skipped on ${process.platform}/${process.arch}; Gate 1 covers macOS arm64, Linux x64, and Windows x64.`);
  process.exit(0);
}

const temporary = await mkdtemp(join(tmpdir(), 'liatir-runtime-box-security-'));
const privatePath = join(temporary, 'signing-private.pem');
const publicPath = join(temporary, 'signing-public.json');
const sharedHome = join(temporary, 'home');
const phaseReports = [join(temporary, 'phase-install.json'), join(temporary, 'phase-restart.json')];
let registry;
try {
  await generateSigningKey({
    privatePath,
    publicPath,
    keyId: 'liatir-runtime-box-security-e2e',
  });
  registry = await startRegistry({ root: temporary, target, privatePath, publicPath });
  const hostPython = process.platform === 'win32' ? await resolveHostPythonExecutable() : null;
  const commonEnvironment = {
    LIATIR_E2E_TEST_HOME_OVERRIDE: sharedHome,
    LIATIR_RUNTIME_BOX_SECURITY_CONTROL_TOKEN: registry.controlToken,
    LIATIR_RUNTIME_BOX_SECURITY_REGISTRY_URL: registry.baseUrl,
    LIATIR_RUNTIME_BOX_SECURITY_TARGET_JSON: JSON.stringify(target),
    LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE: publicPath,
    ...(hostPython ? { LIATIR_RUNTIME_BOX_SECURITY_HOST_PYTHON: hostPython } : {}),
  };
  let runError = null;
  try {
    await runSpec(INSTALL_SPEC, { ...commonEnvironment, LIATIR_E2E_REPORT: phaseReports[0] });
    await runSpec(RESTART_SPEC, { ...commonEnvironment, LIATIR_E2E_REPORT: phaseReports[1] });
  } catch (error) {
    runError = error;
  }
  const reports = await readableReports(phaseReports);
  if (reports.length > 0) await combineReports(process.env.LIATIR_E2E_REPORT, reports);
  if (runError) throw runError;
} finally {
  await registry?.close();
  await rm(temporary, { recursive: true, force: true });
}
