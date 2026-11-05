import type { LiatirHardwareValidationProfile } from "./structure-simulation.js";

export const GNINA_RUNTIME_COMPONENT_ID = "gnina-pose-rescoring" as const;
export const GNINA_BOX_ID = "gnina" as const;
export const GNINA_RUNTIME_ID = "gnina-1-3-3" as const;
export const GNINA_VERSION = "1.3.3" as const;

export const NEURAL_POSE_RESCORING_TOOL_ID = "neural-pose-rescoring" as const;

/** The runner writes the same sentence into every summary; a unit test holds the two equal. */
export const GNINA_INTERPRETATION_NOTICE =
  "GNINA's CNN pose score estimates how likely a pose is to lie within 2 Å of the true binding mode, and its CNN affinity is a predicted binding affinity in pK units; both are predictions of neural networks trained on known complexes, not measurements, and a rescored pose is still a hypothesis to test." as const;

/** One rescored pose, as the runner writes it to the scores table. */
export interface LiatirGninaRescoredPose {
  ligand: string;
  /** Vina's rank within the ligand; 1 is Vina's best. */
  poseRank: number;
  /** GNINA's rank within the ligand by CNN pose score; 1 is GNINA's best. */
  cnnRank: number;
  vinaScoreKcalPerMol: number;
  /** GNINA's own evaluation of the Vina scoring function on the same pose. */
  gninaVinaScoreKcalPerMol: number;
  cnnPoseScore: number;
  cnnAffinityPk: number;
  cnnAffinityVariance: number;
  cnnVs: number;
}

/** The comparison the result page leads with: where Vina and GNINA put each ligand's best pose. */
export interface LiatirGninaLigandComparison {
  ligand: string;
  poses: number;
  bestVinaPoseRank: number;
  bestCnnPoseRank: number;
  bestCnnPoseScore: number;
  bestCnnAffinityPk: number;
  agree: boolean;
}

/**
 * Every sample is transcribed from the retained record named by `evidenceRecord`, and
 * `tests/unit/phase3-hardware-profiles.test.ts` fails if any value drifts from that file. Tokens and
 * outputs are poses, atoms are the receptor's atoms, and one step is one GNINA scoring pass. GPU memory
 * is a device-wide delta on an NVIDIA GeForce RTX 4060 Ti, so it can only over-state. A development
 * measurement stays valid only for this release identity; a production build is re-measured.
 */
export const GNINA_LINUX_X86_64_CUDA128_DEVELOPMENT_PROFILE: LiatirHardwareValidationProfile = {
  schemaVersion: 1,
  profileId: "gnina-pose-rescoring-1.3.3-beta.1-linux-x86_64-cuda12.8-development-2026-11-05",
  componentId: GNINA_RUNTIME_COMPONENT_ID,
  componentVersion: GNINA_VERSION,
  runtimeBoxRelease: "1.3.3-beta.1",
  target: { platform: "linux", arch: "x86_64", accelerator: "cuda", cudaVersion: "12.8" },
  precision: "upstream default",
  measuredAt: "2026-11-05T14:59:16.194Z",
  evidenceRecord: "runtime-boxes/measurements/gnina-linux-x86_64-cuda12.8-development-2026-11-05.json",
  samples: [
    {
      fixtureId: "1iep-redocking",
      workloadId: "gnina:rescore",
      maxTokenCount: 6,
      maxAtomCount: 2702,
      maxStepCount: 1,
      maxOutputItemCount: 6,
      peakRamBytes: 1148197888,
      peakVramBytes: 231735296,
      elapsedMs: 3149,
      outputBytes: 44774,
    },
    {
      fixtureId: "1iep-screen",
      workloadId: "gnina:rescore",
      maxTokenCount: 38,
      maxAtomCount: 2702,
      maxStepCount: 1,
      maxOutputItemCount: 38,
      peakRamBytes: 1174411264,
      peakVramBytes: 231735296,
      elapsedMs: 3319,
      outputBytes: 188870,
    },
    {
      fixtureId: "1iep-screen-repeat",
      workloadId: "gnina:rescore",
      maxTokenCount: 38,
      maxAtomCount: 2702,
      maxStepCount: 1,
      maxOutputItemCount: 38,
      peakRamBytes: 1132951552,
      peakVramBytes: 231735296,
      elapsedMs: 3206,
      outputBytes: 188877,
    },
  ],
};
