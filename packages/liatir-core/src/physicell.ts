import type { LiatirHardwareValidationProfile, LiatirValidationResult } from "./structure-simulation.js";

export const PHYSICELL_RUNTIME_COMPONENT_ID = "physicell-multicellular-simulation" as const;
export const PHYSICELL_BOX_ID = "physicell" as const;
export const PHYSICELL_RUNTIME_ID = "physicell-1-14-2" as const;
export const PHYSICELL_VERSION = "1.14.2" as const;

export const PHYSICELL_TOOL_ID = "multicellular-simulation" as const;

/** The runner writes the same sentence into every summary; a unit test holds the two equal. */
export const PHYSICELL_INTERPRETATION_NOTICE =
  "An agent-based simulation follows the model's cell definitions, rules and parameters, not the tissue they stand for. Cell behaviour is stochastic, so one seed gives one sample; with more than one thread the same seed does not repeat a run exactly." as const;

/** Simulated minutes, as PhysiCell counts time. */
export const PHYSICELL_MAX_TIME_MIN = 100_000;
export const PHYSICELL_MAX_SEED = 2_147_483_647;

export interface LiatirPhysiCellOptions {
  /** Simulated time in minutes; absent, the settings' own max_time. */
  maxTime?: number;
  /** PhysiCell's random seed. */
  seed: number;
  /** OpenMP threads; one is the only count with which a seed repeats a run exactly. */
  threads: number;
}

export const DEFAULT_PHYSICELL_OPTIONS: LiatirPhysiCellOptions = { seed: 0, threads: 1 };

export function validatePhysiCellOptions(options: LiatirPhysiCellOptions, maxThreads: number): LiatirValidationResult {
  const errors: string[] = [];
  if (options.maxTime !== undefined
    && !(Number.isFinite(options.maxTime) && options.maxTime > 0 && options.maxTime <= PHYSICELL_MAX_TIME_MIN)) {
    errors.push(`Simulated time must be positive and at most ${PHYSICELL_MAX_TIME_MIN.toLocaleString("en-US")} minutes.`);
  }
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > PHYSICELL_MAX_SEED) {
    errors.push(`The seed must be a whole number from 0 to ${PHYSICELL_MAX_SEED}.`);
  }
  if (!Number.isInteger(options.threads) || options.threads < 1 || options.threads > maxThreads) {
    errors.push(`Threads must be a whole number from 1 to ${maxThreads}.`);
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

/**
 * Every sample is transcribed from the retained record named by `evidenceRecord`, and
 * `tests/unit/phase3-hardware-profiles.test.ts` fails if any value drifts from that file. Tokens are
 * the cells a run starts with, atoms are voxels times substrates, steps are mechanics steps and
 * outputs are snapshots. They come from production release run 42080211362, which measured the very
 * archive it published.
 */
export const PHYSICELL_LINUX_X86_64_CPU_PRODUCTION_PROFILE: LiatirHardwareValidationProfile = {
  schemaVersion: 1,
  profileId: "physicell-multicellular-simulation-1.14.2-beta.1-linux-x86_64-cpu-production-2026-11-05",
  componentId: PHYSICELL_RUNTIME_COMPONENT_ID,
  componentVersion: PHYSICELL_VERSION,
  runtimeBoxRelease: "1.14.2-beta.1",
  target: { platform: "linux", arch: "x86_64", accelerator: "cpu" },
  precision: "double",
  measuredAt: "2026-11-05T18:08:57.141Z",
  evidenceRecord: "runtime-boxes/measurements/physicell-linux-x86_64-cpu-production-run-42080211362.json",
  samples: [
    {
      fixtureId: "template",
      workloadId: "physicell:template",
      maxTokenCount: 5,
      maxAtomCount: 2500,
      maxStepCount: 72000,
      maxOutputItemCount: 121,
      peakRamBytes: 60055552,
      peakVramBytes: null,
      elapsedMs: 54885,
      outputBytes: 106815,
    },
    {
      fixtureId: "template-repeat",
      workloadId: "physicell:template",
      maxTokenCount: 5,
      maxAtomCount: 2500,
      maxStepCount: 72000,
      maxOutputItemCount: 121,
      peakRamBytes: 54521856,
      peakVramBytes: null,
      elapsedMs: 54580,
      outputBytes: 106815,
    },
    {
      fixtureId: "template-other-seed",
      workloadId: "physicell:template",
      maxTokenCount: 5,
      maxAtomCount: 2500,
      maxStepCount: 72000,
      maxOutputItemCount: 121,
      peakRamBytes: 54525952,
      peakVramBytes: null,
      elapsedMs: 53345,
      outputBytes: 92053,
    },
    {
      fixtureId: "fixed-cycle-doubling",
      workloadId: "physicell:template",
      maxTokenCount: 50,
      maxAtomCount: 10000,
      maxStepCount: 27000,
      maxOutputItemCount: 46,
      peakRamBytes: 56135680,
      peakVramBytes: null,
      elapsedMs: 82617,
      outputBytes: 279436,
    },
    {
      fixtureId: "stochastic-growth",
      workloadId: "physicell:template",
      maxTokenCount: 1000,
      maxAtomCount: 10000,
      maxStepCount: 6000,
      maxOutputItemCount: 11,
      peakRamBytes: 59715584,
      peakVramBytes: null,
      elapsedMs: 36409,
      outputBytes: 914602,
    },
    {
      fixtureId: "apoptosis-survival",
      workloadId: "physicell:template",
      maxTokenCount: 1000,
      maxAtomCount: 10000,
      maxStepCount: 6000,
      maxOutputItemCount: 11,
      peakRamBytes: 56049664,
      peakVramBytes: null,
      elapsedMs: 24156,
      outputBytes: 296779,
    },
    {
      fixtureId: "substrate-decay",
      workloadId: "physicell:template",
      maxTokenCount: 1,
      maxAtomCount: 2500,
      maxStepCount: 10000,
      maxOutputItemCount: 17,
      peakRamBytes: 53481472,
      peakVramBytes: null,
      elapsedMs: 6968,
      outputBytes: 5622,
    },
    {
      fixtureId: "hostile-paths",
      workloadId: "physicell:template",
      maxTokenCount: 7,
      maxAtomCount: 2500,
      maxStepCount: 600,
      maxOutputItemCount: 2,
      peakRamBytes: 53436416,
      peakVramBytes: null,
      elapsedMs: 1691,
      outputBytes: 6252,
    },
  ],
};
