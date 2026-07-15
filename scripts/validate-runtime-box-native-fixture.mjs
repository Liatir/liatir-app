#!/usr/bin/env node

/** Builds and verifies the stdlib-only Runtime Box fixture for the current native host. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  appendFile,
  copyFile,
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
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import yazl from 'yazl';
import {
  downloadVerified,
  payloadSize,
  sha256File,
} from './runtime-box.mjs';
import { extractZipArchive, listZipEntries } from './runtime-box/archive.mjs';
import {
  runtimeBoxReleaseStem,
} from './runtime-box/identity.mjs';
import {
  assertRuntimeBoxNativeHost,
  runtimeBoxTargetAdapter,
} from './runtime-box/targets.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const RUNTIME_BOX_CLI = join(ROOT, 'scripts', 'runtime-box.mjs');
const RECIPE_ROOT = join(ROOT, 'runtime-boxes', 'recipes');
const DIST_ROOT = join(ROOT, '.runtime-box-dist');
const BUILD_ROOT = join(ROOT, '.runtime-box-build');
const HOST_FIXTURES = new Map([
  ['darwin/arm64', 'installer-fixture-macos-arm64'],
  ['linux/x64', 'installer-fixture-linux-x86_64'],
  ['win32/x64', 'installer-fixture-windows-x86_64'],
]);

/** Parses the two explicit inputs accepted by this bounded validator. */
function parseArgs(values) {
  const options = { recipe: '', uv: process.env.LIATIR_RUNTIME_BOX_UV || 'uv' };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === '--recipe') options.recipe = values[++index] ?? '';
    else if (values[index] === '--uv') options.uv = values[++index] ?? '';
    else throw new Error(`Unknown native fixture option: ${values[index]}`);
  }
  return options;
}

/** Runs one process with stable capture and useful failure diagnostics. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture === false ? 'inherit' : 'pipe',
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} exited with ${result.status}: ${result.stderr || result.stdout || ''}`);
  }
  return result;
}

/** Computes SHA-256 for small in-memory fixture values. */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Decodes the signed envelope after checking its embedded payload checksum. */
function decodeSignedPayload(document) {
  const bytes = Buffer.from(document.payloadBase64, 'base64');
  assert.equal(sha256(bytes), document.payloadSha256);
  return JSON.parse(bytes.toString('utf8'));
}

/** Creates a minimal valid wheel used only to prove that a wrong lock hash is rejected. */
async function createLockHashFixtureWheel(path) {
  const zip = new yazl.ZipFile();
  const output = pipeline(zip.outputStream, createWriteStream(path));
  zip.addBuffer(Buffer.from('__version__ = "1.0.0"\n'), 'liatir_lock_fixture/__init__.py');
  zip.addBuffer(Buffer.from([
    'Metadata-Version: 2.1',
    'Name: liatir-lock-fixture',
    'Version: 1.0.0',
    '',
  ].join('\n')), 'liatir_lock_fixture-1.0.0.dist-info/METADATA');
  zip.addBuffer(Buffer.from([
    'Wheel-Version: 1.0',
    'Generator: liatir-runtime-box-foundation',
    'Root-Is-Purelib: true',
    'Tag: py3-none-any',
    '',
  ].join('\n')), 'liatir_lock_fixture-1.0.0.dist-info/WHEEL');
  zip.addBuffer(Buffer.from([
    'liatir_lock_fixture/__init__.py,,',
    'liatir_lock_fixture-1.0.0.dist-info/METADATA,,',
    'liatir_lock_fixture-1.0.0.dist-info/WHEEL,,',
    'liatir_lock_fixture-1.0.0.dist-info/RECORD,,',
    '',
  ].join('\n')), 'liatir_lock_fixture-1.0.0.dist-info/RECORD');
  zip.end();
  await output;
}

/** Proves the exact sync path refuses an artifact whose lock hash does not match. */
async function validateLockHashEnforcement(root, uv, interpreter) {
  const wheel = join(root, 'liatir_lock_fixture-1.0.0-py3-none-any.whl');
  const lock = join(root, 'invalid-hash.lock');
  await createLockHashFixtureWheel(wheel);
  await writeFile(lock, [
    `liatir-lock-fixture @ ${pathToFileURL(wheel).href} \\`,
    `    --hash=sha256:${'0'.repeat(64)}`,
    '',
  ].join('\n'));
  const result = run(uv, [
    'pip', 'sync', lock, '--python', interpreter,
    '--system', '--break-system-packages', '--require-hashes', '--strict', '--no-config',
  ], { allowFailure: true, env: { UV_NO_CONFIG: '1' } });
  assert.notEqual(result.status, 0, 'uv unexpectedly accepted a wheel with the wrong lock hash');
  assert.match(`${result.stderr}\n${result.stdout}`, /hash|digest/i);
}

/** Proves a partial asset is resumed with Range and atomically renamed after hashing. */
async function validateInterruptedDownloadResume(root) {
  const bytes = Buffer.alloc(512 * 1024);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
  const resumeAt = 73_421;
  let rangeHeader = '';
  const server = createServer((request, response) => {
    rangeHeader = request.headers.range ?? '';
    if (rangeHeader === `bytes=${resumeAt}-`) {
      response.writeHead(206, {
        'content-length': bytes.length - resumeAt,
        'content-range': `bytes ${resumeAt}-${bytes.length - 1}/${bytes.length}`,
      });
      response.end(bytes.subarray(resumeAt));
      return;
    }
    response.writeHead(200, { 'content-length': bytes.length });
    response.end(bytes);
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  try {
    const address = server.address();
    assert(address && typeof address === 'object');
    const destination = join(root, 'downloads', 'resume-fixture.bin');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(`${destination}.part`, bytes.subarray(0, resumeAt));
    await downloadVerified({
      relativePath: 'downloads/resume-fixture.bin',
      sha256: sha256(bytes),
      sizeBytes: bytes.length,
      url: `http://127.0.0.1:${address.port}/fixture.bin`,
    }, destination);
    assert.equal(rangeHeader, `bytes=${resumeAt}-`);
    assert.deepEqual(await readFile(destination), bytes);
    await assert.rejects(stat(`${destination}.part`), /ENOENT|no such file/i);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

/** Verifies signed release fields and archive contents independently of the CLI round-trip. */
async function inspectBuiltFixture(recipe, adapter, archivePath, releasePath, extractionRoot) {
  const signed = JSON.parse(await readFile(releasePath, 'utf8'));
  const release = decodeSignedPayload(signed);
  assert.deepEqual(release.target, recipe.target);
  assert.equal(release.pythonEntryPoint, adapter.python.entryPoint);
  assert.equal(release.archive.sha256, await sha256File(archivePath));
  assert.equal(release.archive.sizeBytes, (await stat(archivePath)).size);
  await extractZipArchive(archivePath, extractionRoot);
  assert.equal(release.installedSizeBytes, await payloadSize(extractionRoot));
  assert.equal((await stat(join(extractionRoot, ...adapter.python.entryPoint.split('/')))).isFile(), true);
  const entries = await listZipEntries(archivePath);
  const interpreterEntry = entries.find((entry) => entry.path === adapter.python.entryPoint);
  assert(interpreterEntry, `Archive is missing ${adapter.python.entryPoint}`);
  if (process.platform !== 'win32') {
    assert.equal(interpreterEntry.mode & 0o111, 0o111, 'POSIX interpreter is not executable');
    const extractedMode = (await stat(join(extractionRoot, ...adapter.python.entryPoint.split('/')))).mode;
    assert.equal(extractedMode & 0o111, 0o111, 'Extracted POSIX interpreter is not executable');
  }
  return release;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const expectedRecipe = HOST_FIXTURES.get(`${process.platform}/${process.arch}`);
  assert(expectedRecipe, `No Runtime Box fixture exists for ${process.platform}/${process.arch}`);
  assert.equal(options.recipe, expectedRecipe, `Native host requires fixture ${expectedRecipe}`);

  const recipeDir = join(RECIPE_ROOT, options.recipe);
  const recipe = JSON.parse(await readFile(join(recipeDir, 'recipe.json'), 'utf8'));
  const adapter = runtimeBoxTargetAdapter(recipe.target);
  assertRuntimeBoxNativeHost(adapter);
  assert.deepEqual(recipe.assets, []);
  assert.equal((await readFile(join(recipeDir, recipe.requirementsInput), 'utf8')).trim(), '');
  assert.equal((await readFile(join(recipeDir, recipe.requirementsLock), 'utf8')).trim(), '');

  const uvVersion = run(options.uv, ['--version']).stdout.trim().split(/\s+/)[1];
  assert.equal(uvVersion, recipe.uvVersion);
  run(options.uv, ['python', 'install', recipe.pythonVersion], {
    capture: false,
    env: { UV_NO_CONFIG: '1' },
  });
  const lockPath = join(recipeDir, recipe.requirementsLock);
  const committedLock = await readFile(lockPath);
  run(process.execPath, [
    RUNTIME_BOX_CLI, 'lock', options.recipe,
    '--uv', options.uv,
  ], { capture: false });
  assert.deepEqual(
    await readFile(lockPath),
    committedLock,
    'Regenerating the dependency lock changed the committed bytes',
  );

  const root = await mkdtemp(join(tmpdir(), 'liatir-runtime-box-native-foundation-'));
  const privateKey = join(root, 'signing-private.pem');
  const publicKey = join(root, 'signing-public.json');
  const stem = runtimeBoxReleaseStem(recipe);
  const archivePath = join(DIST_ROOT, `${stem}.zip`);
  const releasePath = join(DIST_ROOT, `${stem}.release.json`);
  const channelPath = join(DIST_ROOT, `${recipe.boxId}-beta-${stem.slice(`${recipe.boxId}-${recipe.version}-`.length)}.channel.json`);
  const buildArgs = [
    RUNTIME_BOX_CLI, 'build', options.recipe,
    '--uv', options.uv,
    '--private-key', privateKey,
    '--public-key', publicKey,
    '--allow-dirty',
  ];
  try {
    run(process.execPath, [
      RUNTIME_BOX_CLI, 'keygen',
      '--private-key', privateKey,
      '--public-key', publicKey,
    ], { capture: false });

    const wrongRecipe = [...HOST_FIXTURES.values()].find((candidate) => candidate !== options.recipe);
    const wrongHost = run(process.execPath, [RUNTIME_BOX_CLI, 'build', wrongRecipe, '--uv', options.uv, '--allow-dirty'], {
      allowFailure: true,
    });
    assert.notEqual(wrongHost.status, 0);
    assert.match(`${wrongHost.stderr}\n${wrongHost.stdout}`, /must be built natively/);

    run(process.execPath, buildArgs, { capture: false });
    run(process.execPath, [
      RUNTIME_BOX_CLI, 'verify', releasePath,
      '--public-key', publicKey,
      '--self-test',
    ], { capture: false });
    const firstArchive = join(root, 'first.zip');
    const firstRelease = join(root, 'first.release.json');
    const firstChannel = join(root, 'first.channel.json');
    await copyFile(archivePath, firstArchive);
    await copyFile(releasePath, firstRelease);
    await copyFile(channelPath, firstChannel);
    const firstReleasePayload = await inspectBuiltFixture(
      recipe,
      adapter,
      archivePath,
      releasePath,
      join(root, 'first-extracted'),
    );

    const tamperedArchive = join(root, 'tampered.zip');
    await copyFile(archivePath, tamperedArchive);
    await appendFile(tamperedArchive, Buffer.from([0]));
    const tampered = run(process.execPath, [
      RUNTIME_BOX_CLI, 'verify', releasePath,
      '--archive', tamperedArchive,
      '--public-key', publicKey,
    ], { allowFailure: true });
    assert.notEqual(tampered.status, 0);
    assert.match(`${tampered.stderr}\n${tampered.stdout}`, /archive size mismatch/i);

    run(process.execPath, buildArgs, { capture: false });
    assert.deepEqual(await readFile(archivePath), await readFile(firstArchive));
    assert.deepEqual(await readFile(releasePath), await readFile(firstRelease));
    assert.deepEqual(await readFile(channelPath), await readFile(firstChannel));
    const secondReleasePayload = await inspectBuiltFixture(
      recipe,
      adapter,
      archivePath,
      releasePath,
      join(root, 'second-extracted'),
    );
    assert.deepEqual(secondReleasePayload, firstReleasePayload);
    run(process.execPath, [
      RUNTIME_BOX_CLI, 'verify', releasePath,
      '--public-key', publicKey,
      '--self-test',
    ], { capture: false });

    const interpreter = join(BUILD_ROOT, recipe.recipeId, 'payload', ...adapter.python.entryPoint.split('/'));
    await validateLockHashEnforcement(root, options.uv, interpreter);
    await validateInterruptedDownloadResume(root);
    console.log(`Runtime Box native foundation passed: ${recipe.recipeId}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`runtime-box-native-foundation: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
