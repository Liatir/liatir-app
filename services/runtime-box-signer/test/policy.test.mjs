import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateSigningPayload } from '../src/policy.mjs';

const policy = JSON.parse(await readFile(new URL('../policy.json', import.meta.url), 'utf8'));
const release = {
  schemaVersion: 1,
  kind: 'liatir.runtime-box.release',
  boxId: 'geneformer-v1-10m',
  modelId: 'ctheodoris-geneformer-v1-10m',
  runtimeId: 'single-cell-foundation-geneformer-v1-10m',
  version: '1.0.0-beta.2',
  target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
  archive: {
    format: 'zip',
    url: `https://assets.models.liatir.com/ai-runtime-boxes/boxes/geneformer-v1-10m/1.0.0-beta.2/macos-aarch64-metal/${'a'.repeat(64)}.zip`,
    sha256: 'a'.repeat(64),
    sizeBytes: 10,
  },
  pythonEntryPoint: 'venv/bin/python',
  modelCacheSubdir: 'model-cache/geneformer-v1-10m',
  selfTest: { pythonImports: ['torch'], timeoutSeconds: 180 },
  provenance: {
    recipeId: 'geneformer-v1-10m-macos-arm64-metal', recipeVersion: '1.0.0',
    builderRevision: 'revision', sourceTreeDirty: false, sourceRevision: 'source',
    pythonVersion: '3.11.9', uvVersion: '0.11.28', dependencyLockSha256: 'b'.repeat(64),
    builtAt: '2026-07-12T00:00:00.000Z',
  },
};

test('accepts an approved immutable release', () => {
  assert.doesNotThrow(() => validateSigningPayload(policy, release));
});

test('rejects an archive hosted outside the controlled origin', () => {
  assert.throws(() => validateSigningPayload(policy, {
    ...release,
    archive: { ...release.archive, url: release.archive.url.replace('assets.models.liatir.com', 'attacker.example') },
  }), /origin is not approved/);
});

test('rejects a box outside the versioned allowlist', () => {
  assert.throws(() => validateSigningPayload(policy, { ...release, boxId: 'unknown' }), /not approved/);
});
