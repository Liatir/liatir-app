/** Runs Protenix base v1.0.0 through Liatir's install, prediction, Job, Result, and removal lifecycle. */
import { structurePredictionLifecycleTest } from '../support/structure-prediction-lifecycle.mjs';

export const tests = [structurePredictionLifecycleTest({
  boxId: 'protenix-base-v1-0-0',
  modelId: 'bytedance-protenix-base-v1-0-0',
  runtimeId: 'structure-protenix-base-v1-0-0',
  modelLabel: 'Protenix base v1.0.0',
  defaultTargetId: 'linux-x86_64-cuda12.6',
  defaultVersion: '1.0.0-beta.1',
  hardwareProfiles: {
    'linux-x86_64-cuda12.6': 'protenix-base-1.0.0-beta.1-linux-x86_64-cuda12.6-development-2026-09-13',
  },
  // The validator's own bound, which sits in the empty band between folded and misfolded runs.
  minimumPlddt: 0.85,
  // Seeds 17 to 21 compete, and 17 won on this protein in every measured run.
  seedRow: '17, the best-ranked of 5 seeds from 17',
})];
