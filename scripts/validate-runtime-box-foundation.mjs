#!/usr/bin/env node

/** Focused Gate 2 validation for safe TAR assets, deterministic Zip64, and Rust extraction. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { open, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDeterministicZip,
  extractRecipeArchive,
  normalizeTree,
  payloadSize,
  sha256File,
  validateArchiveEntryNames,
} from './runtime-box.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ZIP64_FIXTURE_SIZE = (2 ** 32) + 1;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}: ${result.stderr || result.stdout || ''}`);
  }
  return result.stdout ?? '';
}

async function validateTarFoundation(root) {
  const payload = join(root, 'tar-payload');
  const source = join(root, 'tar-source', 'wrapper');
  await mkdir(join(payload, 'downloads'), { recursive: true });
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'asset.txt'), 'verified tar asset\n');
  const archivePath = join(payload, 'downloads', 'valid.tar.gz');
  run('tar', ['-czf', archivePath, '-C', join(root, 'tar-source'), 'wrapper']);
  await extractRecipeArchive(payload, {
    format: 'tar.gz',
    relativePath: 'downloads/valid.tar.gz',
    destination: 'model-cache/fixture',
    stripComponents: 1,
  });
  assert.equal(await readFile(join(payload, 'model-cache/fixture/asset.txt'), 'utf8'), 'verified tar asset\n');

  assert.throws(
    () => validateArchiveEntryNames(['safe/file.txt', '../../escape.txt']),
    /Unsafe relative path/,
  );

  const linkSource = join(root, 'tar-link-source');
  await mkdir(linkSource, { recursive: true });
  await symlink('/etc/passwd', join(linkSource, 'outside-link'));
  const linkArchive = join(payload, 'downloads', 'link.tar.gz');
  run('tar', ['-czf', linkArchive, '-C', linkSource, 'outside-link']);
  await assert.rejects(
    extractRecipeArchive(payload, {
      format: 'tar.gz',
      relativePath: 'downloads/link.tar.gz',
      destination: 'model-cache/rejected',
    }),
    /links and special entries are not allowed/,
  );

  const zipLinkArchive = join(payload, 'downloads', 'link.zip');
  run('zip', ['-y', '-q', zipLinkArchive, 'outside-link'], { cwd: linkSource });
  await assert.rejects(
    extractRecipeArchive(payload, {
      format: 'zip',
      relativePath: 'downloads/link.zip',
      destination: 'model-cache/rejected-zip',
    }),
    /links and special entries are not allowed/,
  );
}

async function validateLargeArchiveFoundation(root) {
  const payload = join(root, 'zip64-payload');
  await mkdir(payload, { recursive: true });
  const fixture = join(payload, 'huge-zero-fixture.bin');
  const handle = await open(fixture, 'w');
  try {
    await handle.truncate(ZIP64_FIXTURE_SIZE);
  } finally {
    await handle.close();
  }
  await normalizeTree(payload);
  assert.equal(await payloadSize(payload), ZIP64_FIXTURE_SIZE);

  const firstArchive = join(root, 'first.zip');
  const secondArchive = join(root, 'second.zip');
  await createDeterministicZip(payload, firstArchive);
  await createDeterministicZip(payload, secondArchive);
  assert.equal(await sha256File(firstArchive), await sha256File(secondArchive));

  const listing = run('unzip', ['-Z', '-l', firstArchive], { capture: true });
  assert.match(listing, /4294967297\s+.*huge-zero-fixture\.bin/);

  run('cargo', ['test', 'runtime_box_large_archive_fixture', '--', '--ignored', '--nocapture'], {
    cwd: join(ROOT, 'src-tauri'),
    env: { LIATIR_RUNTIME_BOX_LARGE_FIXTURE: firstArchive },
  });
}

const root = await mkdtemp(join(tmpdir(), 'liatir-runtime-box-foundation-'));
try {
  await validateTarFoundation(root);
  await validateLargeArchiveFoundation(root);
  console.log('Runtime Box Gate 2 foundation validation passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
