#!/usr/bin/env node

/** Builds and consumes one schema-v2 foundation box on its matching native host. */

import assert from 'node:assert/strict';
import {
  createHash,
  createPrivateKey,
  sign,
} from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { boxTargetId } from 'scrollcase/contract/browser';
import {
  runExtractedBox,
  verifyAndExtractBox,
} from 'scrollcase/consumer';
import { verifySignedDocument } from 'scrollcase/sign';

const ROOT = resolve(import.meta.dirname, '..');
const RUNTIME_BOX_CLI = join(ROOT, 'scripts', 'runtime-box.mjs');
const CATALOG = JSON.parse(await readFile(join(ROOT, 'runtime-boxes', 'catalog.json'), 'utf8'));
const HOST_FIXTURES = new Map([
  ['darwin/arm64', 'installer-fixture-macos-arm64'],
  ['linux/x64', 'installer-fixture-linux-x86_64'],
  ['win32/x64', 'installer-fixture-windows-x86_64'],
]);

function parseArgs(values) {
  // Empty means "let Scrollcase resolve it". Its own precedence is explicit path, then
  // SCROLLCASE_PIXI / SCROLLCASE_CONDA_PACK, then the toolchain the project installed for
  // itself, then PATH. Naming a bare `pixi` here would take the highest slot and defeat the
  // project-local toolchain, so the flag is forwarded only when the caller actually chose one.
  const options = { recipe: '', pixi: '', condaPack: '', output: '' };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === '--recipe') options.recipe = values[++index] ?? '';
    else if (values[index] === '--pixi') options.pixi = values[++index] ?? '';
    else if (values[index] === '--conda-pack') options.condaPack = values[++index] ?? '';
    else if (values[index] === '--output') options.output = values[++index] ?? '';
    else throw new Error(`Unknown native fixture option: ${values[index]}`);
  }
  return options;
}

/** Forwards only the toolchain paths the caller chose, so Scrollcase resolves the rest. */
function toolchainFlags({ condaPack = false } = {}) {
  const flags = [];
  if (options.pixi) flags.push('--pixi', options.pixi);
  if (condaPack && options.condaPack) flags.push('--conda-pack', options.condaPack);
  return flags;
}

/** Runs one argv-only child command and preserves its output on failure. */
function run(command, args, { env = {}, allowFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      shell: false,
      stdio: allowFailure ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status, signal) => {
      const result = { status, signal, stdout, stderr };
      if (!allowFailure && status !== 0) {
        reject(new Error(`${command} exited with ${status ?? signal}: ${stderr || stdout}`));
      } else {
        resolvePromise(result);
      }
    });
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function startFixtureSigner(privatePath, publicPath) {
  const privateKey = createPrivateKey(await readFile(privatePath, 'utf8'));
  const publicKey = JSON.parse(await readFile(publicPath, 'utf8'));
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/v1/sign');
      assert.equal(request.headers.authorization, 'Bearer native-fixture-token');
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const payload = Buffer.from(input.payloadBase64, 'base64');
      assert.equal(sha256(payload), input.payloadSha256);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(`${JSON.stringify({
        schemaVersion: 3,
        payloadEncoding: 'base64-json-utf8',
        payloadBase64: input.payloadBase64,
        payloadSha256: input.payloadSha256,
        signatures: [{
          algorithm: 'ed25519',
          keyId: publicKey.keyId,
          signatureBase64: sign(null, payload, privateKey).toString('base64'),
        }],
      })}\n`);
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolvePromise, reject) => {
      server.close((error) => (error ? reject(error) : resolvePromise()));
    }),
  };
}

async function findBuiltRelease(scroll) {
  const directory = join(
    ROOT,
    '.runtime-box-dist',
    'boxes',
    scroll.boxId,
    scroll.version,
    boxTargetId(scroll.target),
  );
  const names = await readdir(directory);
  const releaseNames = names.filter((name) => name.endsWith('.release.json'));
  const archiveNames = names.filter((name) => name.endsWith('.zip'));
  assert.equal(releaseNames.length, 1);
  assert.equal(archiveNames.length, 1);
  return {
    releasePath: join(directory, releaseNames[0]),
    archivePath: join(directory, archiveNames[0]),
  };
}

const options = parseArgs(process.argv.slice(2));
const nativeFixture = HOST_FIXTURES.get(`${process.platform}/${process.arch}`);
assert(nativeFixture, `No Runtime Box foundation fixture for ${process.platform}/${process.arch}`);
const fixtureId = options.recipe || nativeFixture;
assert.equal(fixtureId, nativeFixture, `Fixture ${fixtureId} does not match this native host`);
const fixture = CATALOG.foundationFixtures.find((candidate) => candidate.recipeId === fixtureId);
assert(fixture, `Foundation fixture is absent from the catalog: ${fixtureId}`);
const targetId = fixture.targetId;
const scrollDir = join(ROOT, 'runtime-boxes', 'scrolls', 'runtime-box-installer-fixture', targetId);
const scroll = JSON.parse(await readFile(join(scrollDir, 'scroll.json'), 'utf8'));
const lockPath = join(scrollDir, 'pixi.lock');
assert.equal(scroll.schemaVersion, 2);
assert.equal(scroll.scrollId, fixtureId);
assert.equal(boxTargetId(scroll.target), targetId);
assert.equal(scroll.uvVersion, undefined);
assert.equal(scroll.requirementsInput, undefined);
assert.equal(scroll.requirementsLock, undefined);
assert.equal((await stat(lockPath)).isFile(), true);

const temporary = await mkdtemp(join(tmpdir(), `liatir-${fixtureId}-v2-`));
const privatePath = join(temporary, 'signing-private.pem');
const publicPath = join(temporary, 'signing-public.json');
const buildReceipt = join(temporary, 'build-receipt.json');
const verifyReceipt = join(temporary, 'verify-receipt.json');
let signer;
try {
  await run(process.execPath, [
    RUNTIME_BOX_CLI,
    'keygen',
    '--private-key', privatePath,
    '--public-key', publicPath,
    '--key-id', `liatir-${fixtureId}-v2`,
  ]);
  const reviewedLock = await readFile(lockPath);
  await run(process.execPath, [
    RUNTIME_BOX_CLI,
    'lock',
    fixtureId,
    ...toolchainFlags(),
  ]);
  const resolvedLock = await readFile(lockPath);
  assert.deepEqual(resolvedLock, reviewedLock, 'native lock resolution changed the reviewed pixi.lock');
  assert.equal(sha256(resolvedLock), fixture.dependencyLockSha256);

  signer = await startFixtureSigner(privatePath, publicPath);
  const buildArgs = [
    RUNTIME_BOX_CLI,
    'build',
    fixtureId,
    ...toolchainFlags({ condaPack: true }),
    '--signer', signer.url,
    '--signer-audience', signer.url,
    '--public-key', publicPath,
    '--receipt', buildReceipt,
    '--allow-dirty',
  ];
  const signerEnvironment = { LIATIR_RUNTIME_BOX_SIGNER_ID_TOKEN: 'native-fixture-token' };
  await run(process.execPath, buildArgs, { env: signerEnvironment });
  const first = await findBuiltRelease(scroll);
  const firstArchiveSha = sha256(await readFile(first.archivePath));
  await run(process.execPath, buildArgs, { env: signerEnvironment });
  const built = await findBuiltRelease(scroll);
  assert.equal(sha256(await readFile(built.archivePath)), firstArchiveSha);

  await run(process.execPath, [
    RUNTIME_BOX_CLI,
    'verify',
    built.releasePath,
    '--archive', built.archivePath,
    '--public-key', publicPath,
    '--self-test',
    '--receipt', verifyReceipt,
  ]);
  const releaseDocument = JSON.parse(await readFile(built.releasePath, 'utf8'));
  const release = await verifySignedDocument(releaseDocument, publicPath);
  assert.equal(release.schemaVersion, 2);
  assert.equal(release.kind, 'liatir.runtime-box.release');
  assert.equal(release.provenance.scrollId, fixtureId);
  assert.equal(release.provenance.dependencyLockSha256, fixture.dependencyLockSha256);
  assert.equal(release.provenance.sourceTreeDirty, false);
  assert.deepEqual(release.execution, scroll.execution);
  assert.equal(release.archive.sha256, firstArchiveSha);
  assert.equal(release.archive.sizeBytes, (await stat(built.archivePath)).size);
  assert.equal(JSON.parse(await readFile(buildReceipt, 'utf8')).status, 'passed');
  assert.equal(JSON.parse(await readFile(verifyReceipt, 'utf8')).selfTest, 'passed');

  const extracted = join(temporary, 'prepared');
  const prepared = await verifyAndExtractBox(built.releasePath, {
    archive: built.archivePath,
    publicPath,
    destination: extracted,
  });
  assert.equal(prepared.targetId, targetId);
  assert.deepEqual(prepared.execution, scroll.execution);
  const ran = await runExtractedBox(prepared, {
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  assert.equal(ran.exitCode, 0);
  assert.equal(ran.signal, null);
  // Scrollcase 0.7.0 added the environment declaration, so a run now reports what the child
  // was given. This fixture declares none, and asserting that is the point: a box that starts
  // silently inheriting host variables, or revealing their values, is a provenance change.
  assert.equal(ran.environmentReport.mode, 'summary');
  assert.equal(ran.environmentReport.hostValuesRevealed, false);
  assert.equal(ran.environmentReport.releaseVariableCount, 0);
  assert.equal(ran.environmentReport.conflictCount, 0);
  assert.deepEqual(ran.environmentReport.dangerousHostVariables, []);
  assert.deepEqual(ran.environmentReport.variables, []);
  assert.equal(typeof ran.environmentReport.remainingVariableCount, 'number');

  await run('cargo', [
    'test',
    'runtime_box_v2_archive_fixture',
    '--manifest-path', join(ROOT, 'src-tauri', 'Cargo.toml'),
    '--',
    '--ignored',
    '--nocapture',
  ], {
    env: {
      LIATIR_RUNTIME_BOX_V2_ARCHIVE_FIXTURE: built.archivePath,
      LIATIR_RUNTIME_BOX_V2_RELEASE_FIXTURE: built.releasePath,
      LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE: publicPath,
    },
  });
  await run('cargo', [
    'test',
    'runtime_box_activation_rollback_and_remove_use_production_transitions',
    '--manifest-path', join(ROOT, 'src-tauri', 'Cargo.toml'),
  ]);
  await run('cargo', [
    'test',
    'rejects_schema_v1_release_manifests',
    '--manifest-path', join(ROOT, 'src-tauri', 'Cargo.toml'),
  ]);

  const v1 = await run(process.execPath, [
    RUNTIME_BOX_CLI,
    'build',
    fixtureId,
    '--scrolls-dir', join(ROOT, 'runtime-boxes', 'recipes'),
  ], { allowFailure: true });
  assert.notEqual(v1.status, 0);
  assert.match(`${v1.stdout}\n${v1.stderr}`, /schema-v1|deprecated|unsupported/i);

  const result = {
    schemaVersion: 2,
    status: 'passed',
    fixtureId,
    targetId,
    archiveSha256: release.archive.sha256,
    archiveSizeBytes: release.archive.sizeBytes,
    installedSizeBytes: release.installedSizeBytes,
    execution: release.execution,
  };
  if (options.output) {
    const outputPath = resolve(ROOT, options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result));
} finally {
  await signer?.close();
  await rm(temporary, { recursive: true, force: true });
}
