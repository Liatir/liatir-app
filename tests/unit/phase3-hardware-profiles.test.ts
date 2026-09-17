import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BOLTZ_2_MODEL_ID,
  BOLTZ_2_PRODUCT_SAMPLING_STEPS,
  BOLTZ_2_VERSION,
  LIATIR_PHASE3_HARDWARE_VALIDATION_PROFILES,
  OPENMM_RUNTIME_COMPONENT_ID,
  OPENMM_VERSION,
  PROTENIX_BASE_V1_MODEL_ID,
  PROTENIX_BASE_V1_VERSION,
  PROTENIX_PRODUCT_DIFFUSION_STEPS,
  estimateHardwareResources,
  phase3HardwareValidationProfile,
  publishedVramRequirements,
  runtimeBoxTargetId,
  structurePredictionWorkloadMetrics,
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
    expect(profile?.profileId).toBe('openmm-8.5.1-beta.1-macos-aarch64-cpu-development-2026-09-09');
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

  // The project's first GPU envelope, and the first published VRAM figures derived from one. The
  // peaks behind them are device-wide deltas, because WSL2 reports no per-process GPU memory; they
  // over-state rather than under-state, which is the safe direction for a minimum.
  it('resolves the retained OpenMM Linux CUDA envelope and publishes VRAM from its peak', () => {
    const target = {
      platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.9',
    } as const;
    const profile = phase3HardwareValidationProfile({
      componentId: OPENMM_RUNTIME_COMPONENT_ID,
      componentVersion: OPENMM_VERSION,
      runtimeBoxRelease: '8.5.1-beta.1',
      target,
    });
    expect(profile?.profileId)
      .toBe('openmm-8.5.1-beta.1-linux-x86_64-cuda12.9-development-2026-09-09');

    // 185 MiB measured on an 8 GiB card: OpenMM's GPU cost is the CUDA context, not the system size.
    expect(publishedVramRequirements(profile!)).toEqual({
      measuredPeakVramBytes: 193986560,
      minimumVramBytes: 242483200,
      recommendedVramBytes: 290979840,
    });

    // Solvated DHFR, the real production shape, is inside the measured envelope on this target.
    expect(estimateHardwareResources({
      workloadId: 'openmm:dynamics:tip3p-fb:standard',
      tokenCount: 1,
      atomCount: 29419,
      stepCount: 5000,
      outputItemCount: 2,
    }, profile!)).toMatchObject({
      accepted: true,
      evidence: 'measured',
      sampleFixtureId: 'dhfr-solvated-dynamics-10ps',
    });

    // CUDA 12.8 is a different target and still has no measurement of its own.
    expect(phase3HardwareValidationProfile({
      componentId: OPENMM_RUNTIME_COMPONENT_ID,
      componentVersion: OPENMM_VERSION,
      runtimeBoxRelease: '8.5.1-beta.1',
      target: { ...target, cudaVersion: '12.8' },
    })).toBe(null);
  });

  // The validators write each sample themselves, and the app derives a request's dimensions in core.
  // Replaying every retained structure case through the app's function is what keeps the two from
  // drifting: a mismatch here means a measured run would be judged as some other size.
  it('derives structure workload metrics exactly as every retained structure sample records them', () => {
    const structureProfiles = LIATIR_PHASE3_HARDWARE_VALIDATION_PROFILES
      .filter((profile) => [BOLTZ_2_MODEL_ID, PROTENIX_BASE_V1_MODEL_ID].includes(profile.componentId as never));
    expect(structureProfiles.length).toBeGreaterThan(0);
    for (const profile of structureProfiles) {
      const measurement = retainedMeasurement(profile.evidenceRecord);
      const boltz = profile.componentId === BOLTZ_2_MODEL_ID;
      for (const sample of profile.samples) {
        const summary = measurement.cases.find((entry: { id: string }) => entry.id === sample.fixtureId).summary;
        const metrics = structurePredictionWorkloadMetrics(profile.componentId as typeof BOLTZ_2_MODEL_ID, {
          tokenEstimate: summary.tokenEstimate,
          structureCount: boltz ? summary.modelCount : summary.structureCount,
          steps: boltz ? BOLTZ_2_PRODUCT_SAMPLING_STEPS : PROTENIX_PRODUCT_DIFFUSION_STEPS,
          affinity: boltz && summary.affinityPredValue != null,
        });
        expect({
          workloadId: metrics.workloadId,
          maxTokenCount: metrics.tokenCount,
          maxAtomCount: metrics.atomCount,
          maxStepCount: metrics.stepCount,
          maxOutputItemCount: metrics.outputItemCount,
        }).toEqual({
          workloadId: sample.workloadId,
          maxTokenCount: sample.maxTokenCount,
          maxAtomCount: sample.maxAtomCount,
          maxStepCount: sample.maxStepCount,
          maxOutputItemCount: sample.maxOutputItemCount,
        });
      }
    }
  });

  it('measures Boltz-2 structure on ubiquitin and affinity on carbonic anhydrase II, and asks beyond them', () => {
    const profile = phase3HardwareValidationProfile({
      componentId: BOLTZ_2_MODEL_ID,
      componentVersion: BOLTZ_2_VERSION,
      runtimeBoxRelease: '2.2.1-beta.1',
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.9' },
    })!;
    expect(profile.profileId).toBe('boltz-2-2.2.1-beta.1-linux-x86_64-cuda12.9-production-2026-09-17');
    const ubiquitin = structurePredictionWorkloadMetrics(BOLTZ_2_MODEL_ID, {
      tokenEstimate: 76, structureCount: 1, steps: BOLTZ_2_PRODUCT_SAMPLING_STEPS, affinity: false,
    });
    expect(estimateHardwareResources(ubiquitin, profile)).toMatchObject({
      accepted: true, evidence: 'measured', sampleFixtureId: 'ubiquitin-single-sequence',
    });
    // One residue past what was measured is honestly beyond the evidence, not estimated from it.
    expect(estimateHardwareResources({ ...ubiquitin, tokenCount: 77 }, profile)).toMatchObject({
      accepted: true, evidence: 'beyond-evidence', confirmationRequired: true,
    });

    // 260 residues plus acetazolamide's 26-character SMILES, exactly the retained affinity case.
    const acetazolamide = structurePredictionWorkloadMetrics(BOLTZ_2_MODEL_ID, {
      tokenEstimate: 286, structureCount: 1, steps: BOLTZ_2_PRODUCT_SAMPLING_STEPS, affinity: true,
    });
    expect(estimateHardwareResources(acetazolamide, profile)).toMatchObject({
      accepted: true, evidence: 'measured', sampleFixtureId: 'carbonic-anhydrase-2-acetazolamide',
    });
    expect(estimateHardwareResources({ ...acetazolamide, tokenCount: 287 }, profile)).toMatchObject({
      accepted: true, evidence: 'beyond-evidence', confirmationRequired: true,
    });
    // Each workload keeps its own evidence: the affinity runs do not stretch structure past ubiquitin.
    expect(estimateHardwareResources({ ...ubiquitin, tokenCount: 286 }, profile)).toMatchObject({
      accepted: true, evidence: 'beyond-evidence', confirmationRequired: true,
    });
  });

  it('measures Protenix at its competing-seed default and asks before drawing more', () => {
    const profile = phase3HardwareValidationProfile({
      componentId: PROTENIX_BASE_V1_MODEL_ID,
      componentVersion: PROTENIX_BASE_V1_VERSION,
      runtimeBoxRelease: '1.0.0-beta.1',
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.6' },
    })!;
    expect(profile.profileId).toBe('protenix-base-1.0.0-beta.1-linux-x86_64-cuda12.6-development-2026-09-13');
    // Five seeds of five samples: the product's default is exactly what was measured.
    const ubiquitin = structurePredictionWorkloadMetrics(PROTENIX_BASE_V1_MODEL_ID, {
      tokenEstimate: 76, structureCount: 25, steps: PROTENIX_PRODUCT_DIFFUSION_STEPS, affinity: false,
    });
    expect(estimateHardwareResources(ubiquitin, profile)).toMatchObject({
      accepted: true, evidence: 'measured', sampleFixtureId: 'ubiquitin-single-sequence',
    });
    // Fewer structures cost no more than the measured run, so they are inside the evidence too.
    expect(estimateHardwareResources({ ...ubiquitin, outputItemCount: 5 }, profile))
      .toMatchObject({ accepted: true, evidence: 'measured' });
    expect(estimateHardwareResources({ ...ubiquitin, outputItemCount: 26 }, profile))
      .toMatchObject({ accepted: true, evidence: 'beyond-evidence', confirmationRequired: true });
    // A published VRAM minimum now exists, from the measured peak with the required margins.
    expect(publishedVramRequirements(profile)).toEqual({
      measuredPeakVramBytes: 3414163456,
      minimumVramBytes: 4267704320,
      recommendedVramBytes: 5121245184,
    });
  });

  it('measures what it can, confirms what it cannot, and refuses only what cannot finish', () => {
    const profile = phase3HardwareValidationProfile({
      componentId: OPENMM_RUNTIME_COMPONENT_ID,
      componentVersion: OPENMM_VERSION,
      runtimeBoxRelease: '8.5.1-beta.1',
      target: { platform: 'macos', arch: 'aarch64', accelerator: 'cpu' },
    })!;
    const relaxation = {
      workloadId: 'openmm:relaxation:none:standard',
      tokenCount: 1,
      stepCount: 5000,
      outputItemCount: 1,
    };
    expect(estimateHardwareResources({ ...relaxation, atomCount: 33 }, profile)).toMatchObject({
      accepted: true,
      evidence: 'measured',
      confirmationRequired: false,
      hardwareProfileId: profile.profileId,
      sampleFixtureId: 'official-protein-relaxation',
      estimatedRamBytes: 83886080,
      estimatedVramBytes: null,
    });

    // Dihydrofolate reductase, the standard benchmark protein, is now measured rather than refused.
    expect(estimateHardwareResources({ ...relaxation, atomCount: 2489 }, profile)).toMatchObject({
      accepted: true,
      evidence: 'measured',
      sampleFixtureId: 'dhfr-protein-relaxation',
      estimatedRamBytes: 115703808,
      estimatedTimeMs: 10676,
    });

    // That protein with an approved drug bound to it: the ligand path costs an order of magnitude
    // more memory than the same protein alone, because it loads the charge model.
    expect(estimateHardwareResources({
      workloadId: 'openmm:relaxation:none:openff',
      tokenCount: 1,
      atomCount: 2530,
      stepCount: 5000,
      outputItemCount: 1,
    }, profile)).toMatchObject({
      accepted: true,
      evidence: 'measured',
      sampleFixtureId: 'dhfr-drug-ligand-relaxation',
      estimatedRamBytes: 604307456,
    });

    // And the production shape: a real protein the runner put in explicit water, 29,419 atoms.
    expect(estimateHardwareResources({
      workloadId: 'openmm:dynamics:tip3p-fb:standard',
      tokenCount: 1,
      atomCount: 29_419,
      stepCount: 5000,
      outputItemCount: 10,
    }, profile)).toMatchObject({
      accepted: true,
      evidence: 'measured',
      sampleFixtureId: 'dhfr-solvated-dynamics-10ps',
      estimatedRamBytes: 365821952,
    });

    // Past the largest measured protein the run is confirmable, with a floor and no invented figure.
    const huge = { ...relaxation, atomCount: 60_000 };
    expect(estimateHardwareResources(huge, profile)).toMatchObject({
      accepted: true,
      evidence: 'beyond-evidence',
      confirmationRequired: true,
      floorFixtureId: 'dhfr-protein-relaxation',
      minimumRamBytes: 115703808,
      maxValidatedAtomCount: 2489,
    });
    expect(estimateHardwareResources(huge, profile, { totalMemoryBytes: 17_179_869_184 }))
      .toMatchObject({ accepted: true, evidence: 'beyond-evidence' });
    expect(estimateHardwareResources(huge, profile, { totalMemoryBytes: 67_108_864 }))
      .toMatchObject({ accepted: false, reason: 'impossible' });

    // A workload the validator never ran has no envelope, whatever its size.
    expect(estimateHardwareResources({
      workloadId: 'openmm:dynamics:tip3p-fb:openff',
      tokenCount: 1,
      atomCount: 10,
      stepCount: 10,
      outputItemCount: 1,
    }, profile)).toMatchObject({ accepted: false, reason: 'no-evidence' });
  });
});
