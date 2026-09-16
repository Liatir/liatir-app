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
import { runtimeBoxPolicyFingerprint, runtimeBoxTargetId, validateSigningPayload } from '../src/policy.mjs';

const policy = JSON.parse(await readFile(new URL('../policy.json', import.meta.url), 'utf8'));
/** A known-good release, used as the baseline that each rejection test then perturbs one field of. */
const release = {
  schemaVersion: 3,
  kind: 'liatir.runtime-box.release',
  boxId: 'geneformer-v1-10m',
  labels: {
    model: 'ctheodoris-geneformer-v1-10m',
    runtime: 'single-cell-foundation-geneformer-v1-10m',
  },
  version: '1.0.0-beta.2',
  target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
  archive: {
    format: 'zip',
    url: `https://assets.models.liatir.com/ai-runtime-boxes/boxes/geneformer-v1-10m/1.0.0-beta.2/macos-aarch64-metal/${'a'.repeat(64)}.zip`,
    sha256: 'a'.repeat(64),
    sizeBytes: 10,
  },
  runtime: { id: 'python', version: '3.11.9', entryPoint: 'venv/bin/python' },
  cacheSubdir: 'model-cache/geneformer-v1-10m',
  selfTest: { probe: { imports: ['torch'] }, timeoutSeconds: 180 },
  provenance: {
    scrollId: 'geneformer-v1-10m-macos-arm64-metal', scrollVersion: '1.0.0',
    builderRevision: 'revision', sourceTreeDirty: false, sourceRevision: 'source',
    runtimeVersion: '3.11.9', pixiVersion: '0.73.0', dependencyLockSha256: 'b'.repeat(64),
    builtAt: '2026-07-12T00:00:00.000Z',
  },
};

const approvedIndex = policy.referenceIndexes[0];
const indexCatalog = {
  schemaVersion: 2,
  kind: 'liatir.single-cell-index.catalog',
  updatedAt: '2026-08-24T00:00:00.000Z',
  indexes: [{
    id: approvedIndex.id,
    version: approvedIndex.version,
    label: approvedIndex.label,
    species: {
      commonName: approvedIndex.commonName,
      scientificName: approvedIndex.scientificName,
      taxonId: approvedIndex.taxonId,
    },
    genome: {
      assembly: approvedIndex.assembly,
      source: {
        url: approvedIndex.genomeUrl,
        checksum: { algorithm: approvedIndex.genomeChecksumAlgorithm, value: approvedIndex.genomeChecksum },
      },
    },
    annotation: {
      provider: approvedIndex.annotationProvider,
      release: approvedIndex.annotationRelease,
      format: approvedIndex.annotationFormat,
      source: {
        url: approvedIndex.annotationUrl,
        checksum: { algorithm: approvedIndex.annotationChecksumAlgorithm, value: approvedIndex.annotationChecksum },
      },
    },
    referenceType: approvedIndex.referenceType,
    readLength: approvedIndex.readLength,
    archive: {
      format: 'zip',
      url: `https://assets.models.liatir.com/ai-runtime-boxes/reference-indexes/${approvedIndex.id}/${approvedIndex.version}/${'c'.repeat(64)}.zip`,
      sha256: 'c'.repeat(64),
      sizeBytes: 100,
    },
    toolchain: {
      simpleafVersion: approvedIndex.simpleafVersion,
      piscemVersion: approvedIndex.piscemVersion,
      nativeToolsLockSha256: approvedIndex.nativeToolsLockSha256,
    },
    provenance: {
      recipeSha256: approvedIndex.recipeSha256,
      sourceRevision: 'd'.repeat(40),
      builtAt: '2026-08-24T00:00:00.000Z',
    },
  }],
};

test('accepts an approved immutable release', () => {
  assert.doesNotThrow(() => validateSigningPayload(policy, release));
});

test('accepts only the approved scientific identity for a reference-index catalog', () => {
  assert.doesNotThrow(() => validateSigningPayload(policy, indexCatalog));
  assert.throws(() => validateSigningPayload(policy, {
    ...indexCatalog,
    indexes: [{ ...indexCatalog.indexes[0], readLength: 100 }],
  }), /read length does not match/);
  assert.throws(() => validateSigningPayload(policy, {
    ...indexCatalog,
    indexes: [{
      ...indexCatalog.indexes[0],
      archive: { ...indexCatalog.indexes[0].archive, url: indexCatalog.indexes[0].archive.url.replace('assets.models.liatir.com', 'attacker.example') },
    }],
  }), /origin is not approved/);
});

test('accepts the approved UCE Runtime Box identity', () => {
  const uceRelease = {
    ...release,
    boxId: 'uce-4layer',
    labels: { model: 'snap-stanford-uce-4layer', runtime: 'single-cell-foundation-uce' },
    version: '1.0.0-beta.1',
    archive: {
      ...release.archive,
      url: `https://assets.models.liatir.com/ai-runtime-boxes/boxes/uce-4layer/1.0.0-beta.1/macos-aarch64-metal/${'a'.repeat(64)}.zip`,
    },
    installedSizeBytes: 10_142_871_337,
    cacheSubdir: 'model-cache/uce',
  };

  assert.doesNotThrow(() => validateSigningPayload(policy, uceRelease));
});

test('accepts the approved scGPT Linux CPU identity', () => {
  const targetId = 'linux-x86_64-cpu';
  assert.doesNotThrow(() => validateSigningPayload(policy, {
    ...release,
    boxId: 'scgpt-whole-human',
    labels: { model: 'bowang-scgpt-whole-human', runtime: 'single-cell-foundation-scgpt-whole-human' },
    version: '0.2.5-beta.1',
    target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
    compatibility: {
      minLiatirVersion: '0.2.1',
      minRamGb: 16,
      hostEnvironments: ['native'],
    },
    archive: {
      ...release.archive,
      url: `https://assets.models.liatir.com/ai-runtime-boxes/boxes/scgpt-whole-human/0.2.5-beta.1/${targetId}/${'a'.repeat(64)}.zip`,
    },
    cacheSubdir: 'model-cache/scgpt-whole-human',
    provenance: {
      ...release.provenance,
      scrollId: 'scgpt-whole-human-linux-x86_64-cpu',
    },
  }));
});

test('accepts an optional signed installed size', () => {
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

test('accepts Linux payload metadata for native and WSL2 hosts', () => {
  const linuxTarget = { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.4' };
  const linuxTargetId = 'linux-x86_64-cuda12.4';
  const linuxPolicy = {
    ...policy,
    boxes: policy.boxes.map((box) => box.boxId === release.boxId
      ? { ...box, targets: [...box.targets, linuxTargetId] }
      : box),
  };
  assert.doesNotThrow(() => validateSigningPayload(linuxPolicy, {
    ...release,
    target: linuxTarget,
    compatibility: {
      minLiatirVersion: '0.2.1',
      hostEnvironments: ['native', 'windows-wsl2'],
    },
    archive: {
      ...release.archive,
      url: `https://assets.models.liatir.com/ai-runtime-boxes/boxes/geneformer-v1-10m/1.0.0-beta.2/${linuxTargetId}/${'a'.repeat(64)}.zip`,
    },
  }));
});

test('accepts the approved native Windows CUDA payload', () => {
  const targetId = 'windows-x86_64-cuda12.8';
  assert.doesNotThrow(() => validateSigningPayload(policy, {
    ...release,
    target: { platform: 'windows', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.8' },
    compatibility: {
      minLiatirVersion: '0.2.1',
      minRamGb: 16,
      minNvidiaDriverVersion: '527.41',
      hostEnvironments: ['native'],
    },
    archive: {
      ...release.archive,
      url: `https://assets.models.liatir.com/ai-runtime-boxes/boxes/geneformer-v1-10m/1.0.0-beta.2/${targetId}/${'a'.repeat(64)}.zip`,
    },
    runtime: { ...release.runtime, entryPoint: 'venv/python.exe' },
    provenance: {
      ...release.provenance,
      scrollId: 'geneformer-v1-10m-windows-x86_64-cuda12.8',
    },
  }));
});

test('matches the shared Runtime Box target ID contract', async () => {
  const contract = JSON.parse(await readFile(new URL('../../../runtime-boxes/target-id-contract.json', import.meta.url), 'utf8'));
  for (const fixture of contract.valid) {
    assert.equal(runtimeBoxTargetId(fixture.target), fixture.targetId, fixture.name);
  }
  for (const fixture of contract.invalid) {
    assert.throws(() => runtimeBoxTargetId(fixture.target), undefined, fixture.name);
  }
});

test('rejects schema-v1 payloads explicitly', () => {
  assert.throws(
    () => validateSigningPayload(policy, { ...release, schemaVersion: 1 }),
    /unsupported Runtime Box schema/,
  );
});

// The move to box format 3 once required version 3 of every kind, and so refused the reference-index
// catalog, which the app and the Registry still read as version 2. These tests did not run in any
// gate, so nothing noticed until a signer deployment was about to ship it.
test('holds each document kind to its own schema version', () => {
  assert.throws(() => validateSigningPayload(policy, { ...release, schemaVersion: 2 }), /unsupported Runtime Box schema/);
  assert.throws(() => validateSigningPayload(policy, { ...indexCatalog, schemaVersion: 3 }), /unsupported Runtime Box schema/);
  assert.throws(() => validateSigningPayload(policy, { ...release, kind: 'constructor' }), /not signable/);
});

test('accepts the structure models only at their approved CUDA targets', () => {
  const structureRelease = (boxId, model, runtime, version, cudaVersion) => {
    const targetId = `linux-x86_64-cuda${cudaVersion}`;
    return {
      ...release,
      boxId,
      labels: { model, runtime },
      version,
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion },
      compatibility: { minLiatirVersion: '0.2.1', hostEnvironments: ['native', 'windows-wsl2'] },
      archive: {
        ...release.archive,
        url: `https://assets.models.liatir.com/ai-runtime-boxes/boxes/${boxId}/${version}/${targetId}/${'a'.repeat(64)}.zip`,
      },
    };
  };
  const boltz = structureRelease('boltz-2', 'jwohlwend-boltz-2', 'structure-boltz-2-2-1', '2.2.1-beta.1', '12.9');
  const protenix = structureRelease(
    'protenix-base-v1-0-0', 'bytedance-protenix-base-v1-0-0', 'structure-protenix-base-v1-0-0', '1.0.0-beta.1', '12.6',
  );
  assert.doesNotThrow(() => validateSigningPayload(policy, boltz));
  assert.doesNotThrow(() => validateSigningPayload(policy, protenix));
  assert.throws(
    () => validateSigningPayload(policy, structureRelease('boltz-2', 'jwohlwend-boltz-2', 'structure-boltz-2-2-1', '2.2.1-beta.1', '12.6')),
    /target is not approved/,
  );
});

test('accepts native host metadata and rejects WSL2 metadata on non-Linux payloads', () => {
  assert.doesNotThrow(() => validateSigningPayload(policy, {
    ...release,
    compatibility: { minLiatirVersion: '0.2.1', hostEnvironments: ['native'] },
  }));
  assert.throws(() => validateSigningPayload(policy, {
    ...release,
    compatibility: { minLiatirVersion: '0.2.1', hostEnvironments: ['native', 'windows-wsl2'] },
  }), /windows-wsl2 is only valid for Linux payloads/);
});

test('rejects unknown or duplicate host environments', () => {
  assert.throws(() => validateSigningPayload(policy, {
    ...release,
    compatibility: { minLiatirVersion: '0.2.1', hostEnvironments: ['container'] },
  }), /invalid host environment/);
  assert.throws(() => validateSigningPayload(policy, {
    ...release,
    compatibility: { minLiatirVersion: '0.2.1', hostEnvironments: ['native', 'native'] },
  }), /host environments must be unique/);
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

// The fingerprint is what a release compares against /health to catch a stale deployment. It must
// depend only on content, so reordered keys or reformatted whitespace never look like drift, while
// any real change to an approval list does.
test('policy fingerprint is stable across key order and whitespace', () => {
  const reordered = { boxes: policy.boxes, allowedChannels: policy.allowedChannels, ...policy };
  assert.equal(runtimeBoxPolicyFingerprint(policy), runtimeBoxPolicyFingerprint(reordered));
  assert.equal(runtimeBoxPolicyFingerprint(policy), runtimeBoxPolicyFingerprint(JSON.parse(JSON.stringify(policy))));
});

test('policy fingerprint changes when an approval list changes', () => {
  const withNewTarget = structuredClone(policy);
  withNewTarget.boxes.find((box) => box.boxId === 'scgpt-whole-human').targets.push('linux-x86_64-cuda12.4');
  assert.notEqual(runtimeBoxPolicyFingerprint(policy), runtimeBoxPolicyFingerprint(withNewTarget));
});
