import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import catalog from '../../runtime-boxes/catalog.json';
import {
  runtimeBoxBuildDiskPlan,
  validateRuntimeBoxCiCatalog,
  validateWindowsCudaPrerequisite,
} from '../../scripts/runtime-box-ci.mjs';
import { heartbeatLine } from '../../scripts/runtime-box/heartbeat.mjs';

describe('Runtime Box CI cost controls', () => {
  it('pins every model lock and calculates disk before native allocation', () => {
    for (const model of catalog.models) {
      for (const target of model.targets) {
        const recipe = JSON.parse(readFileSync(resolve(
          `runtime-boxes/recipes/${target.recipeId}/recipe.json`,
        ), 'utf8'));
        const plan = runtimeBoxBuildDiskPlan(recipe, target);
        expect(target.dependencyLockSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(plan.calculatedPeakDiskBytes).toBeLessThanOrEqual(target.requiredBuildDiskBytes);
        expect(plan.safetyMarginBytes).toBeGreaterThan(0);
      }
    }
  });

  it('rejects lock drift before any native runner is resolved', () => {
    const changed = structuredClone(catalog);
    changed.models[0].targets[0].dependencyLockSha256 = '0'.repeat(64);
    expect(() => validateRuntimeBoxCiCatalog(changed, { requireWorkflows: false }))
      .toThrow(/dependency lock SHA-256 mismatch/);
  });

  it('rejects reviewed Python-license audit drift before a native build', () => {
    const changed = structuredClone(catalog);
    const cpu = changed.models[0].targets.find((target) => target.targetId === 'linux-x86_64-cpu');
    cpu.dependencyLicenseAudit = 'runtime-boxes/legal/audits/missing.json';
    expect(() => validateRuntimeBoxCiCatalog(changed, { requireWorkflows: false }))
      .toThrow(/recipe and catalog dependency license audits differ|missing dependency license audit/);
  });

  it('keeps Windows CUDA disabled until same-model Linux CUDA validation passes', () => {
    const linux = {
      targetId: 'linux-x86_64-cuda12.4',
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.4' },
      status: 'planned',
      nativeCiEnabled: false,
    };
    const windows = {
      targetId: 'windows-x86_64-cuda12.4',
      target: { platform: 'windows', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.4' },
      status: 'planned',
      nativeCiEnabled: true,
      linuxValidationPrerequisiteTargetId: linux.targetId,
    };
    const model = { modelId: 'model', targets: [linux, windows] };
    expect(() => validateWindowsCudaPrerequisite(model, windows)).toThrow(/before Linux scientific validation/);
    linux.status = 'scientifically-validated';
    expect(() => validateWindowsCudaPrerequisite(model, windows)).not.toThrow();
  });

  it('uses one concise heartbeat line without verbose status output', () => {
    expect(heartbeatLine('scientific validation', 17 * 60_000))
      .toBe('[runtime-box heartbeat] scientific validation is still running (17 min elapsed)');
  });
});
