import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LIATIR_PHASE3_HARDWARE_VALIDATION_PROFILES,
  OPENMM_RUNTIME_COMPONENT_ID,
  OPENMM_VERSION,
  estimateHardwareResources,
  phase3HardwareValidationProfile,
  publishedVramRequirements,
  runtimeBoxTargetId,
} from '@liatir/core';

const ROOT = resolve(import.meta.dirname, '../..');

function retainedMeasurement(relativePath: string) {
  return JSON.parse(readFileSync(resolve(ROOT, relativePath), 'utf8'));
}

describe('Phase 3 retained hardware envelopes', () => {
  it('carries only samples transcribed from a retained passing measurement record', () => {
    expect(LIATIR_PHASE3_HARDWARE_VALIDATION_PROFILES.length).toBeGreaterThan(0);
    for (const profile of LIATIR_PHASE3_HARDWARE_VALIDATION_PROFILES) {
      const measurement = retainedMeasurement(profile.evidenceRecord);
      expect(measurement.status).toBe('passed');
      expect(measurement.modelId).toBe(profile.componentId);
      expect(measurement.targetId).toBe(runtimeBoxTargetId(profile.target));
      expect(measurement.createdAt).toBe(profile.measuredAt);
      // Byte-for-byte: an edited literal here would silently widen a published run limit.
      expect(profile.samples).toEqual(measurement.hardwareSamples);
      expect(profile.samples.length).toBeGreaterThan(0);
    }
  });

  it('resolves the retained OpenMM macOS CPU envelope for its exact release identity', () => {
    const target = { platform: 'macos', arch: 'aarch64', accelerator: 'cpu' } as const;
    const profile = phase3HardwareValidationProfile({
      componentId: OPENMM_RUNTIME_COMPONENT_ID,
      componentVersion: OPENMM_VERSION,
      runtimeBoxRelease: '8.5.1-beta.1',
      target,
    });
    expect(profile?.profileId).toBe('openmm-8.5.1-beta.1-macos-aarch64-cpu-development-2026-09-06');
    expect(publishedVramRequirements(profile!)).toBe(null);

    // A different release or target of the same component still has no measurement of its own.
    expect(phase3HardwareValidationProfile({
      componentId: OPENMM_RUNTIME_COMPONENT_ID,
      componentVersion: OPENMM_VERSION,
      runtimeBoxRelease: '8.5.1-beta.2',
      target,
    })).toBe(null);
    expect(phase3HardwareValidationProfile({
      componentId: OPENMM_RUNTIME_COMPONENT_ID,
      componentVersion: OPENMM_VERSION,
      runtimeBoxRelease: '8.5.1-beta.1',
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
    })).toBe(null);
  });

  it('accepts a measured relaxation and refuses anything larger than the retained samples', () => {
    const profile = phase3HardwareValidationProfile({
      componentId: OPENMM_RUNTIME_COMPONENT_ID,
      componentVersion: OPENMM_VERSION,
      runtimeBoxRelease: '8.5.1-beta.1',
      target: { platform: 'macos', arch: 'aarch64', accelerator: 'cpu' },
    })!;
    const accepted = estimateHardwareResources({
      workloadId: 'openmm:relaxation:none:standard',
      tokenCount: 1,
      atomCount: 33,
      stepCount: 5000,
      outputItemCount: 1,
    }, profile);
    expect(accepted).toMatchObject({
      accepted: true,
      hardwareProfileId: profile.profileId,
      estimatedRamBytes: 81985536,
      estimatedVramBytes: null,
    });

    const tooLarge = estimateHardwareResources({
      workloadId: 'openmm:relaxation:none:standard',
      tokenCount: 1,
      atomCount: 34,
      stepCount: 5000,
      outputItemCount: 1,
    }, profile);
    expect(tooLarge).toMatchObject({ accepted: false, maxValidatedAtomCount: 33 });

    // A workload the validator never ran has no envelope, whatever its size.
    expect(estimateHardwareResources({
      workloadId: 'openmm:dynamics:tip3p-fb:openff',
      tokenCount: 1,
      atomCount: 10,
      stepCount: 10,
      outputItemCount: 1,
    }, profile)).toMatchObject({ accepted: false });
  });
});
