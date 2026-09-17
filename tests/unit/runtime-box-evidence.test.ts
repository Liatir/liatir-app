import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import catalog from '../../runtime-boxes/catalog.json';
import {
  signedBuildSourceEvidence,
  sourceEvidence,
  validateRuntimeBoxCiEvidence,
  writeModelEvidence,
} from '../../scripts/runtime-box/evidence.mjs';

const sha256 = 'a'.repeat(64);

function productionRecord() {
  return {
    schemaVersion: 1,
    kind: 'liatir.runtime-box.ci-evidence',
    phase: 'production-release',
    status: 'passed',
    createdAt: '2026-07-15T18:00:00.000Z',
    subject: {
      modelId: 'ctheodoris-geneformer-v1-10m',
      boxId: 'geneformer-v1-10m',
      runtimeId: 'single-cell-foundation-geneformer-v1-10m',
      recipeId: 'geneformer-v1-10m-macos-arm64-metal',
      recipeVersion: '1.0.0',
      version: '1.0.0-beta.1',
      targetId: 'macos-aarch64-metal',
      mode: 'native-lifecycle',
    },
    source: { repository: 'Liatir/liatir-stack', commitSha: 'b'.repeat(40), sourceTreeDirty: false },
    workflow: {
      provider: 'github-actions',
      workflow: 'Runtime Box production release',
      runId: '123',
      runAttempt: '1',
      runUrl: 'https://github.com/Liatir/liatir-stack/actions/runs/123',
      actor: 'operator',
      triggeringActor: 'operator',
      environment: 'runtime-box-production',
      approver: null,
    },
    host: {
      platform: 'macos',
      arch: 'aarch64',
      runnerName: 'runner',
      runnerLabel: 'macos-15',
      runnerEnvironment: 'github-hosted',
      image: 'macos-15',
      freeDiskBytesBefore: 50_000_000_000,
      minimumFreeDiskBytes: 45_000_000_000,
      peakAdditionalDiskBytes: 5_000_000_000,
      gpuModel: 'Apple M2',
      driverVersion: null,
      reportedCudaCompatibility: null,
    },
    build: {
      recipeSha256: sha256,
      dependencyLockSha256: sha256,
      pythonVersion: '3.11.9',
      uvVersion: '0.11.28',
      archiveSha256: sha256,
      archiveSizeBytes: 10,
      installedSizeBytes: 20,
      elapsedMs: 100,
      selfTest: { status: 'passed', imports: ['torch'], localSignatureVerified: true },
    },
    scientific: {
      validator: { path: 'scripts/validator.mjs', sha256 },
      productScript: { path: 'frontend/product.ts', sha256 },
      fixture: { id: 'fixture-v1', sha256, inputShapes: { counts: [4, 128] } },
      sources: [{ kind: 'checkpoint', identity: 'https://example.test/model', revision: 'rev', sha256 }],
      framework: { name: 'torch', version: '2.0.0', backend: 'metal' },
      accelerator: { kind: 'metal', gpuModel: 'Apple M2', driverVersion: null, reportedCudaCompatibility: null },
      outputShapes: { embeddings: [4, 256] },
      finiteValues: true,
      tolerances: { absolute: 0.000001 },
      parity: { passed: true },
      elapsedMs: 100,
      peakRamBytes: null,
      peakVramBytes: null,
      outputContract: 'passed',
      provenanceContract: 'passed',
    },
    publication: {
      signingKeyIds: ['liatir-runtime-box-kms-2026'],
      localSignatureVerified: true,
      archive: { url: 'https://assets.example.test/archive.zip', sizeBytes: 10, sha256, streamedVerification: 'passed' },
      release: { url: 'https://assets.example.test/release.json', sizeBytes: 20, sha256, streamedVerification: 'passed' },
      channelUrl: 'https://models.example.test/v1/channels/beta/box/target',
      promotionHttpStatus: 200,
      promotionResponse: { ok: true },
    },
    productLifecycle: {
      status: 'passed',
      targetId: 'macos-aarch64-metal',
      version: '1.0.0-beta.1',
      jobId: 'job-1',
      analysisRunId: 'run-1',
      accelerator: 'Metal',
      resultArtifactCount: 3,
      assertions: { results: 'passed', provenance: 'passed', removal: 'passed' },
    },
  };
}

describe('Runtime Box CI evidence contract', () => {
  it('keeps signed build cleanliness when later product preparation changes tracked files', () => {
    const commitSha = 'b'.repeat(40);
    expect(signedBuildSourceEvidence(
      { repository: 'Liatir/liatir-stack', commitSha, sourceTreeDirty: true },
      { builderRevision: commitSha, sourceTreeDirty: false },
    )).toEqual({
      repository: 'Liatir/liatir-stack',
      commitSha,
      sourceTreeDirty: false,
    });
    expect(() => signedBuildSourceEvidence(
      { repository: 'Liatir/liatir-stack', commitSha, sourceTreeDirty: false },
      { builderRevision: 'c'.repeat(40), sourceTreeDirty: false },
    )).toThrow(/release commit/);
  });

  it('accepts a complete protected production record', () => {
    expect(() => validateRuntimeBoxCiEvidence(productionRecord())).not.toThrow();
  });

  it('rejects a successful scientific record without finite-value evidence', () => {
    const record = productionRecord();
    record.scientific.finiteValues = false;
    expect(() => validateRuntimeBoxCiEvidence(record)).toThrow(/finite-value check/);
  });

  it('requires full product lifecycle evidence for a successful Linux release', () => {
    const record: any = productionRecord();
    record.subject.targetId = 'linux-x86_64-cpu';
    record.subject.recipeId = 'geneformer-v1-10m-linux-x86_64-cpu';
    record.host.platform = 'linux';
    record.host.arch = 'x86_64';
    record.scientific.accelerator.kind = 'cpu';
    delete record.productLifecycle;
    expect(() => validateRuntimeBoxCiEvidence(record)).toThrow(/product lifecycle evidence/);

    record.productLifecycle = {
      status: 'passed',
      targetId: 'linux-x86_64-cpu',
      version: '1.0.0-beta.1',
      jobId: 'job-1',
      analysisRunId: 'run-1',
      accelerator: 'CPU',
      resultArtifactCount: 3,
      assertions: { results: 'passed', provenance: 'passed', removal: 'passed' },
    };
    expect(() => validateRuntimeBoxCiEvidence(record)).not.toThrow();
  });

  it('requires complete T4, CPU-baseline, CUDA, and product-runner evidence', () => {
    const record: any = productionRecord();
    record.subject.targetId = 'linux-x86_64-cuda12.4';
    record.subject.recipeId = 'geneformer-v1-10m-linux-x86_64-cuda12.4';
    record.productLifecycle.targetId = 'linux-x86_64-cuda12.4';
    Object.assign(record.host, {
      platform: 'linux',
      arch: 'x86_64',
      gpuModel: 'Tesla T4',
      gpuCount: 1,
      gpuMemoryBytes: 16_106_127_360,
      computeCapability: '7.5',
      driverVersion: '590.48.01',
      reportedCudaCompatibility: '12.4',
    });
    Object.assign(record.scientific, {
      framework: { name: 'torch', version: '2.4.1+cu124', backend: 'transformers-cu124' },
      accelerator: {
        kind: 'cuda',
        gpuModel: 'Tesla T4',
        gpuMemoryBytes: 15_814_754_304,
        computeCapability: '7.5',
        driverVersion: '590.48.01',
        reportedCudaCompatibility: '12.4',
      },
      parity: { passed: true, cpuBaselinePassed: true, acceleratorPassed: true },
      peakVramBytes: 1_024,
    });
    record.productLifecycle = {
      status: 'passed',
      targetId: record.subject.targetId,
      version: record.subject.version,
      jobId: 'job-cuda',
      analysisRunId: 'run-cuda',
      accelerator: 'CUDA',
      gpuModel: 'Tesla T4',
      computeCapability: '7.5',
      reportedCudaCompatibility: '12.4',
      peakVramBytes: 1_024,
      resultArtifactCount: 3,
      assertions: { results: 'passed', provenance: 'passed', removal: 'passed' },
    };

    expect(() => validateRuntimeBoxCiEvidence(record)).not.toThrow();
    record.scientific.parity.cpuBaselinePassed = false;
    expect(() => validateRuntimeBoxCiEvidence(record)).toThrow(/CPU baseline/);
    // A structure model anchors its CUDA run to an experimental structure instead, and only a passed
    // comparison counts; the accelerator run itself must still have passed.
    record.scientific.parity = { anchor: 'experimental-structure', passed: true, cpuBaselinePassed: null, acceleratorPassed: true };
    expect(() => validateRuntimeBoxCiEvidence(record)).not.toThrow();
    record.scientific.parity.passed = false;
    expect(() => validateRuntimeBoxCiEvidence(record)).toThrow(/CPU baseline or experimental structure/);
    record.scientific.parity = { anchor: 'experimental-structure', passed: true, cpuBaselinePassed: null, acceleratorPassed: null };
    expect(() => validateRuntimeBoxCiEvidence(record)).toThrow(/accelerator parity/);
    record.scientific.parity = { passed: true, cpuBaselinePassed: true, acceleratorPassed: true };
    record.productLifecycle.peakVramBytes = null;
    expect(() => validateRuntimeBoxCiEvidence(record)).toThrow(/product peak VRAM/);
  });

  it('accepts compact failed evidence without manufacturing successful sections', () => {
    const record = productionRecord();
    record.phase = 'model-validation';
    record.status = 'failed';
    delete record.host;
    delete record.build;
    delete record.scientific;
    delete record.publication;
    expect(() => validateRuntimeBoxCiEvidence(record)).not.toThrow();
  });

  it('assembles complete model evidence from checked inputs and local receipts', async () => {
    const root = resolve(import.meta.dirname, '../..');
    await mkdir(join(root, '.runtime-box-ci'), { recursive: true });
    const workDir = await mkdtemp(join(root, '.runtime-box-ci/evidence-unit-'));
    try {
      const recipe = JSON.parse(await readFile(
        join(root, 'runtime-boxes/scrolls/geneformer-v1-10m/macos-aarch64-metal/scroll.json'),
        'utf8',
      ));
      const lockSha256 = createHash('sha256').update(await readFile(
        join(root, 'runtime-boxes/scrolls/geneformer-v1-10m/macos-aarch64-metal/pixi.lock'),
      )).digest('hex');
      const source = sourceEvidence();
      const release = {
        schemaVersion: 3,
        kind: 'liatir.runtime-box.release',
        boxId: recipe.boxId,
        labels: { model: recipe.labels.model, runtime: recipe.labels.runtime },
        version: recipe.version,
        target: recipe.target,
        archive: { format: 'zip', url: 'https://assets.example.test/archive.zip', sha256, sizeBytes: 10 },
        installedSizeBytes: 20,
        selfTest: { probe: { imports: ['torch'] }, timeoutSeconds: 180 },
        provenance: {
          scrollId: recipe.scrollId,
          scrollVersion: recipe.scrollVersion,
          builderRevision: source.commitSha,
          sourceTreeDirty: source.sourceTreeDirty,
          sourceRevision: recipe.sourceRevision,
          pythonVersion: recipe.runtime.version,
          pixiVersion: recipe.pixiVersion,
          dependencyLockSha256: lockSha256,
          builtAt: '2026-07-15T18:00:00.000Z',
        },
      };
      const payload = Buffer.from(JSON.stringify(release));
      const releasePath = join(workDir, 'release.json');
      await writeFile(releasePath, JSON.stringify({
        schemaVersion: 3,
        payloadEncoding: 'base64-json-utf8',
        payloadBase64: payload.toString('base64'),
        payloadSha256: createHash('sha256').update(payload).digest('hex'),
        signatures: [{ algorithm: 'ed25519', keyId: 'test-key', signatureBase64: 'test' }],
      }));
      const files = {
        host: {
          platform: 'macos', arch: 'aarch64', runnerName: null, runnerLabel: 'macos-15', runnerEnvironment: null, image: null,
          freeDiskBytesBefore: 100, minimumFreeDiskBytes: null, peakAdditionalDiskBytes: null,
          gpuModel: 'Apple', driverVersion: null, reportedCudaCompatibility: null,
        },
        metrics: { elapsedMs: 10, minimumFreeDiskBytes: 80, peakAdditionalDiskBytes: 20 },
        verification: { status: 'passed', localSignatureVerified: true },
        scientific: {
          status: 'passed',
          elapsedMs: 12,
          result: {
            status: 'passed',
            evidence: {
              fixture: { id: 'fixture-v1', sha256, inputShapes: { counts: [4, 128] } },
              framework: { name: 'torch', version: '2.0.0', backend: 'metal', reportedCudaCompatibility: null },
              accelerator: { kind: 'metal', gpuModel: null, driverVersion: null, reportedCudaCompatibility: null },
              outputShapes: { embeddings: [4, 256] },
              finiteValues: true,
              tolerances: { absolute: 0.000001 },
              parity: { passed: true },
              peakRamBytes: null,
              peakVramBytes: null,
              outputContract: 'passed',
              provenanceContract: 'passed',
            },
          },
        },
      };
      for (const [name, value] of Object.entries(files)) {
        await writeFile(join(workDir, `${name}.json`), JSON.stringify(value));
      }
      const output = join(workDir, 'evidence.json');
      await writeModelEvidence({
        status: 'passed',
        model: recipe.labels.model,
        recipe: recipe.scrollId,
        target: 'macos-aarch64-metal',
        mode: 'scientific',
        release: releasePath,
        host: join(workDir, 'host.json'),
        metrics: join(workDir, 'metrics.json'),
        verification: join(workDir, 'verification.json'),
        scientific: join(workDir, 'scientific.json'),
        output,
      }, catalog);
      const record = JSON.parse(await readFile(output, 'utf8'));
      expect(record).toMatchObject({
        status: 'passed',
        build: { dependencyLockSha256: lockSha256 },
        scientific: { finiteValues: true, accelerator: { kind: 'metal' } },
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
