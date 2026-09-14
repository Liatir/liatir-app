#!/usr/bin/env node

/** Focused foundation validation for the published deterministic ZIP API and Rust Zip64 extraction. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { open, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDeterministicZip,
  listZipEntries,
  sha256File,
} from 'scrollcase/build';
import { boxTargetAdapter } from 'scrollcase/contract/browser';

const ROOT = resolve(import.meta.dirname, '..');
const ZIP64_FIXTURE_SIZE = (2 ** 32) + 1;
const MACOS_ADAPTER = boxTargetAdapter({
  platform: 'macos', arch: 'aarch64', accelerator: 'metal',
});

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
  assert.equal((await stat(fixture)).size, ZIP64_FIXTURE_SIZE);

  const firstArchive = join(root, 'first.zip');
  const secondArchive = join(root, 'second.zip');
  // The fixture runs nothing; a runtime is named only because it decides which entries are executable.
  await createDeterministicZip(payload, firstArchive, MACOS_ADAPTER, { runtimeId: 'native' });
  await createDeterministicZip(payload, secondArchive, MACOS_ADAPTER, { runtimeId: 'native' });
  assert.equal(await sha256File(firstArchive), await sha256File(secondArchive));

  const entries = await listZipEntries(firstArchive);
  assert.equal(entries.find((entry) => entry.path === 'huge-zero-fixture.bin')?.size, ZIP64_FIXTURE_SIZE);

  run('cargo', ['test', 'runtime_box_large_archive_fixture', '--', '--ignored', '--nocapture'], {
    cwd: join(ROOT, 'src-tauri'),
    env: { LIATIR_RUNTIME_BOX_LARGE_FIXTURE: firstArchive },
  });
}

const root = await mkdtemp(join(tmpdir(), 'liatir-runtime-box-foundation-'));
try {
  await validateLargeArchiveFoundation(root);
  console.log('Runtime Box published-build and Rust Zip64 foundation validation passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
