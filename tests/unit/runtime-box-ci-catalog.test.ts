import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import catalogJson from '../../runtime-boxes/catalog.json';
import {
  BUILT_IN_AI_MODEL_REGISTRY,
  runtimeBoxTargetId,
  type LiatirRuntimeBoxCiCatalog,
} from '../../packages/liatir-core/src';
import {
  foundationMatrix,
  numericVersionAtLeast,
  resolveCiTarget,
  runtimeBoxEvidenceOptions,
  validateRuntimeBoxCiCatalog,
} from '../../scripts/runtime-box-ci.mjs';

const catalog = catalogJson as LiatirRuntimeBoxCiCatalog;

describe('Runtime Box CI catalog', () => {
  it('validates repository identities, legal gates, recipes, runners, and publication evidence', () => {
    expect(() => validateRuntimeBoxCiCatalog(catalog, { requireWorkflows: false })).not.toThrow();
  });

  it('keeps published core targets exactly aligned with published catalog targets', () => {
    for (const record of catalog.models) {
      const model = BUILT_IN_AI_MODEL_REGISTRY.find((candidate) => candidate.id === record.modelId);
      const appTargets = model?.install?.runtimeBox?.publishedTargets ?? [];
      const catalogTargets = record.targets.filter((target) => target.status === 'published');

      expect(model?.install?.runtimeBox?.boxId).toBe(record.boxId);
      expect(model?.install?.runtimeId).toBe(record.runtimeId);
      expect(appTargets.map((candidate) => runtimeBoxTargetId(candidate.target)).sort())
        .toEqual(catalogTargets.map((target) => target.targetId).sort());
      for (const target of catalogTargets) {
        const candidate = appTargets.find((value) => runtimeBoxTargetId(value.target) === target.targetId);
        expect(candidate?.hostEnvironments).toEqual(target.hostEnvironments);
      }
    }
  });

  it('resolves runner labels only through an exact model, recipe, target, and mode tuple', () => {
    const resolved = resolveCiTarget(
      catalog,
      'ctheodoris-geneformer-v1-10m',
      'geneformer-v1-10m-macos-arm64-metal',
      'macos-aarch64-metal',
      'scientific',
    );
    expect(resolved.runner).toMatchObject({ runsOn: 'macos-15', platform: 'macos', arch: 'aarch64' });
    expect(() => resolveCiTarget(
      catalog,
      'ctheodoris-geneformer-v1-10m',
      'geneformer-v1-10m-macos-arm64-metal',
      'macos-aarch64-metal',
      'arbitrary-mode',
    )).toThrow(/mode arbitrary-mode is not approved/);
  });

  it('derives the Linux CPU recipe and runner only from the checked model and target', () => {
    const resolved = resolveCiTarget(
      catalog,
      'ctheodoris-geneformer-v1-10m',
      undefined,
      'linux-x86_64-cpu',
      'native-lifecycle',
    );
    expect(resolved.target).toMatchObject({
      recipeId: 'geneformer-v1-10m-linux-x86_64-cpu',
      status: 'published',
      dependencyLicenseAudit: 'runtime-boxes/legal/audits/geneformer-v1-10m-linux-x86_64-cpu.json',
    });
    expect(resolved.runner).toMatchObject({ runsOn: 'ubuntu-24.04', gpu: false });
  });

  it('derives the checked Linux CUDA recipe and exact T4 runner contract', () => {
    const resolved = resolveCiTarget(
      catalog,
      'ctheodoris-geneformer-v1-10m',
      undefined,
      'linux-x86_64-cuda12.4',
      'native-lifecycle',
    );
    expect(resolved.target).toMatchObject({
      recipeId: 'geneformer-v1-10m-linux-x86_64-cuda12.4',
      status: 'buildable',
      timeoutMinutes: 35,
      gpuRequired: true,
      dependencyLockSha256: '4cc737f7bb6580de2fc6da0d89f2a17a2f200a35c82f5734f7e503c1772579ed',
    });
    expect(resolved.runner).toMatchObject({
      runsOn: 'liatir-linux-t4',
      gpu: true,
      expectedGpuModel: 'Tesla T4',
      minimumGpuMemoryBytes: 15_000_000_000,
      expectedComputeCapability: '7.5',
    });
  });

  it('compares NVIDIA driver versions component by component', () => {
    expect(numericVersionAtLeast('590.48.01', '550.54.14')).toBe(true);
    expect(numericVersionAtLeast('550.54.14', '550.54.14')).toBe(true);
    expect(numericVersionAtLeast('550.54.2', '550.54.14')).toBe(false);
    expect(numericVersionAtLeast('not-a-version', '550.54.14')).toBe(false);
  });

  it('derives the small native fixture matrix from checked runner profiles', () => {
    expect(foundationMatrix(catalog)).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipeId: 'installer-fixture-linux-x86_64', runsOn: 'ubuntu-24.04', heartbeatSeconds: 300 }),
      expect.objectContaining({ recipeId: 'installer-fixture-windows-x86_64', runsOn: 'windows-2025' }),
      expect.objectContaining({ recipeId: 'installer-fixture-macos-arm64', runsOn: 'macos-15' }),
    ]));
  });

  it('keeps the checked cost policy manual, serial, uncached, and low-noise', () => {
    expect(catalog.costPolicy).toEqual({
      maxPaidRunnerConcurrency: 1,
      maxModelsPerGpuJob: 1,
      maxTargetsPerGpuJob: 1,
      heartbeatSeconds: 300,
      gpuManualOnly: true,
      scheduledGpuWorkflows: false,
      linuxCudaBeforeWindowsCuda: true,
      cacheModelWeightsOrArchives: false,
    });
  });

  it('checks the paid native host under pinned Node before authentication or setup downloads', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/runtime-box-release.yml', import.meta.url), 'utf8');
    const releaseJob = workflow.slice(workflow.indexOf('\n  release:\n'));
    const setupNode = releaseJob.indexOf('actions/setup-node@v4');
    const hostProbe = releaseJob.indexOf('npm run runtime-box:ci -- host-probe');
    const releaseAuth = releaseJob.indexOf('id: release-auth');
    const npmInstall = releaseJob.indexOf('run: npm ci');
    expect(setupNode).toBeGreaterThanOrEqual(0);
    expect(setupNode).toBeLessThan(hostProbe);
    expect(hostProbe).toBeLessThan(releaseAuth);
    expect(hostProbe).toBeLessThan(npmInstall);
  });

  it('suppresses npm wrapper output before parsing one canonical validator result', () => {
    const ciSource = readFileSync(new URL('../../scripts/runtime-box-ci.mjs', import.meta.url), 'utf8');
    expect(ciSource).toContain("['run', '--silent', script]");
    expect(ciSource).toContain('JSON.parse(result.stdout.trim())');
  });

  it('maps workflow receipt flags to the evidence API contract', () => {
    expect(runtimeBoxEvidenceOptions(new Map([
      ['publish-receipt', 'publish.json'],
      ['promotion-receipt', 'promotion.json'],
      ['product-lifecycle', 'product.json'],
    ]))).toEqual({
      publishReceipt: 'publish.json',
      promotionReceipt: 'promotion.json',
      productLifecycle: 'product.json',
    });
  });

  it('keeps UCE native CI disabled until a runner has enough working storage', () => {
    const uce = catalog.models.find((model) => model.boxId === 'uce-4layer');
    expect(uce?.targets[0]).toMatchObject({
      status: 'published',
      requiredBuildDiskBytes: 32_212_254_720,
      nativeCiEnabled: false,
    });
  });
});
