import { describe, expect, it } from 'vitest';
import catalogJson from '../../runtime-boxes/catalog.json';
import {
  BUILT_IN_AI_MODEL_REGISTRY,
  runtimeBoxTargetId,
  type LiatirRuntimeBoxCiCatalog,
} from '../../packages/liatir-core/src';
import {
  foundationMatrix,
  resolveCiTarget,
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

  it('keeps UCE native CI disabled until a runner has enough working storage', () => {
    const uce = catalog.models.find((model) => model.boxId === 'uce-4layer');
    expect(uce?.targets[0]).toMatchObject({
      status: 'published',
      requiredBuildDiskBytes: 32_212_254_720,
      nativeCiEnabled: false,
    });
  });
});
