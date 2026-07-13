/**
 * Tests for the signing policy — the gate that decides what the KMS key will and will not sign.
 *
 * This is the last line of defence in the release chain: anything the policy accepts becomes a
 * document every Liatir install trusts unconditionally. The two rejection tests below cover the
 * cases that would actually be dangerous — an archive pointed at an origin we do not control, and
 * a box that was never approved for release.
 *
 * Run against the real `policy.json`, not a fixture, so the deployed policy itself is what is
 * under test.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateSigningPayload } from '../src/policy.mjs';

const policy = JSON.parse(await readFile(new URL('../policy.json', import.meta.url), 'utf8'));
/** A known-good release, used as the baseline that each rejection test then perturbs one field of. */
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

test('accepts a signed installed size while keeping legacy releases valid', () => {
  assert.doesNotThrow(() => validateSigningPayload(policy, {
    ...release,
    installedSizeBytes: 25,
  }));
  assert.doesNotThrow(() => validateSigningPayload(policy, release));
});

test('rejects an invalid installed size', () => {
  assert.throws(() => validateSigningPayload(policy, {
    ...release,
    installedSizeBytes: 0,
  }), /invalid installed size/);
});

// Without this rule, a signed release could direct every installation to download and execute an
// archive from a host we do not control — the signature would make it look entirely legitimate.
test('rejects an archive hosted outside the controlled origin', () => {
  assert.throws(() => validateSigningPayload(policy, {
    ...release,
    archive: { ...release.archive, url: release.archive.url.replace('assets.models.liatir.com', 'attacker.example') },
  }), /origin is not approved/);
});

// The allowlist means the signer cannot be used to bless an arbitrary new box, only the ones that
// were explicitly approved for release.
test('rejects a box outside the versioned allowlist', () => {
  assert.throws(() => validateSigningPayload(policy, { ...release, boxId: 'unknown' }), /not approved/);
});
