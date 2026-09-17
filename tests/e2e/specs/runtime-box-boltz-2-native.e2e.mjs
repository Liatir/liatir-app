/** Runs Boltz-2 through Liatir's install, prediction, Job, Result, and removal lifecycle. */
import { structurePredictionLifecycleTest } from '../support/structure-prediction-lifecycle.mjs';

export const tests = [structurePredictionLifecycleTest({
  boxId: 'boltz-2',
  modelId: 'jwohlwend-boltz-2',
  runtimeId: 'structure-boltz-2-2-1',
  modelLabel: 'Boltz-2 2.2.1',
  defaultTargetId: 'linux-x86_64-cuda12.9',
  defaultVersion: '2.2.1-beta.1',
  hardwareProfiles: {
    'linux-x86_64-cuda12.9': 'boltz-2-2.2.1-beta.1-linux-x86_64-cuda12.9-production-2026-09-17',
  },
  // The validator's own bound for Boltz-2 on this protein.
  minimumPlddt: 0.7,
  seedRow: '17',
  // Boltz-2 alone predicts affinity, held to the validator's bound for a 12 nM inhibitor.
  affinity: { minimumBindingProbability: 0.5 },
})];
