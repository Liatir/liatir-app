import type { LiatirHardwareValidationProfile, LiatirValidationResult } from "./structure-simulation.js";

export const METABOLIC_MODELING_RUNTIME_COMPONENT_ID = "cobrapy-metabolic-modeling" as const;
export const METABOLIC_MODELING_BOX_ID = "metabolic-modeling" as const;
export const METABOLIC_MODELING_RUNTIME_ID = "metabolic-modeling-cobrapy-0-32-1" as const;
export const COBRAPY_VERSION = "0.32.1" as const;
export const HIGHS_VERSION = "1.15.1" as const;

export const METABOLIC_MODELING_TOOL_ID = "metabolic-modeling" as const;

/** The runner writes the same sentence into every summary; a unit test holds the two equal. */
export const METABOLIC_MODELING_INTERPRETATION_NOTICE =
  "Flux balance analysis predicts steady-state fluxes that optimize the chosen objective under the model's stoichiometry and bounds. A predicted growth rate or flux is a property of the model and its assumptions, not a measurement; an essential gene in the model is a hypothesis about the organism." as const;

export const METABOLIC_ANALYSES = ["fba", "fva", "gene-deletion", "reaction-deletion"] as const;
export type LiatirMetabolicAnalysis = (typeof METABOLIC_ANALYSES)[number];

/** A flux bound beyond this is a stand-in for "unbounded", not a physiological limit. */
export const METABOLIC_MAX_ABS_BOUND = 1_000_000;
export const METABOLIC_MAX_CHANGES = 1_000;

export interface LiatirFluxBoundChange {
  reaction: string;
  lower: number;
  upper: number;
}

export interface LiatirMetabolicOptions {
  analysis: LiatirMetabolicAnalysis;
  /** A reaction id to optimize; empty keeps the objective the model defines. */
  objective: string;
  direction: "max" | "min";
  bounds: LiatirFluxBoundChange[];
  /** Genes knocked out before the analysis runs. */
  knockouts: string[];
  /** Flux variability keeps the objective at least this fraction of its optimum. */
  fractionOfOptimum: number;
  /** For FBA: report the flux distribution with the least total flux among the optimal ones. */
  pfba: boolean;
  /** Solve again with GLPK and refuse the result if the two solvers disagree. */
  crossCheck: boolean;
}

export const DEFAULT_METABOLIC_OPTIONS: LiatirMetabolicOptions = {
  analysis: "fba",
  objective: "",
  direction: "max",
  bounds: [],
  knockouts: [],
  fractionOfOptimum: 1,
  pfba: false,
  crossCheck: true,
};

export function validateMetabolicOptions(options: LiatirMetabolicOptions): LiatirValidationResult {
  const errors: string[] = [];
  if (!METABOLIC_ANALYSES.includes(options.analysis)) errors.push(`The analysis must be one of: ${METABOLIC_ANALYSES.join(", ")}.`);
  if (options.direction !== "max" && options.direction !== "min") errors.push("The objective direction must be max or min.");
  if (!Number.isFinite(options.fractionOfOptimum) || options.fractionOfOptimum < 0 || options.fractionOfOptimum > 1) {
    errors.push("The fraction of the optimum must be between 0 and 1.");
  }
  if (options.bounds.length > METABOLIC_MAX_CHANGES || options.knockouts.length > METABOLIC_MAX_CHANGES) {
    errors.push(`Change at most ${METABOLIC_MAX_CHANGES} bounds and knock out at most ${METABOLIC_MAX_CHANGES} genes.`);
  }
  const seen = new Set<string>();
  for (const change of options.bounds) {
    const reaction = change.reaction.trim();
    if (!reaction) errors.push("Every bound change needs a reaction.");
    else if (seen.has(reaction)) errors.push(`The bounds of ${reaction} are changed twice.`);
    seen.add(reaction);
    if (![change.lower, change.upper].every((value) => Number.isFinite(value) && Math.abs(value) <= METABOLIC_MAX_ABS_BOUND)) {
      errors.push(`The bounds of ${reaction || "a reaction"} must be finite and within ±${METABOLIC_MAX_ABS_BOUND.toLocaleString("en-US")}.`);
    } else if (change.lower > change.upper) {
      errors.push(`The lower bound of ${reaction} exceeds its upper bound.`);
    }
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

/**
 * Bound changes written one per line as `reaction lower upper`, the way a modeller notes a medium,
 * for example `EX_glc__D_e -10 1000`.
 */
export function parseFluxBoundChanges(text: string): LiatirFluxBoundChange[] {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const parts = line.split(/[\s,;]+/u);
    if (parts.length !== 3) throw new Error(`Bound line ${index + 1} must read: reaction lower upper.`);
    return { reaction: parts[0], lower: Number(parts[1]), upper: Number(parts[2]) };
  });
}

/**
 * Every sample is transcribed from the retained record named by `evidenceRecord`, and
 * `tests/unit/phase3-hardware-profiles.test.ts` fails if any value drifts from that file. They come
 * from production release run 42068626028, which measured the very archive it published.
 */
export const METABOLIC_MODELING_LINUX_X86_64_CPU_PRODUCTION_PROFILE: LiatirHardwareValidationProfile = {
  schemaVersion: 1,
  profileId: "cobrapy-metabolic-modeling-0.32.1-beta.1-linux-x86_64-cpu-production-2026-11-05",
  componentId: METABOLIC_MODELING_RUNTIME_COMPONENT_ID,
  componentVersion: COBRAPY_VERSION,
  runtimeBoxRelease: "0.32.1-beta.1",
  target: { platform: "linux", arch: "x86_64", accelerator: "cpu" },
  precision: "double",
  measuredAt: "2026-11-05T17:08:26.669Z",
  evidenceRecord: "runtime-boxes/measurements/metabolic-modeling-linux-x86_64-cpu-production-run-42068626028.json",
  samples: [
    {
      fixtureId: "textbook-fba",
      workloadId: "cobra:fba",
      maxTokenCount: 2,
      maxAtomCount: 95,
      maxStepCount: 1,
      maxOutputItemCount: 95,
      peakRamBytes: 241795072,
      peakVramBytes: null,
      elapsedMs: 1365,
      outputBytes: 7751,
    },
    {
      fixtureId: "textbook-parsimonious-fba",
      workloadId: "cobra:fba",
      maxTokenCount: 2,
      maxAtomCount: 95,
      maxStepCount: 2,
      maxOutputItemCount: 95,
      peakRamBytes: 242204672,
      peakVramBytes: null,
      elapsedMs: 1433,
      outputBytes: 7809,
    },
    {
      fixtureId: "textbook-json-fba",
      workloadId: "cobra:fba",
      maxTokenCount: 2,
      maxAtomCount: 95,
      maxStepCount: 1,
      maxOutputItemCount: 95,
      peakRamBytes: 232996864,
      peakVramBytes: null,
      elapsedMs: 1280,
      outputBytes: 7737,
    },
    {
      fixtureId: "textbook-fva",
      workloadId: "cobra:fva",
      maxTokenCount: 2,
      maxAtomCount: 95,
      maxStepCount: 191,
      maxOutputItemCount: 95,
      peakRamBytes: 242323456,
      peakVramBytes: null,
      elapsedMs: 1895,
      outputBytes: 14611,
    },
    {
      fixtureId: "textbook-fva-repeat",
      workloadId: "cobra:fva",
      maxTokenCount: 2,
      maxAtomCount: 95,
      maxStepCount: 191,
      maxOutputItemCount: 95,
      peakRamBytes: 242266112,
      peakVramBytes: null,
      elapsedMs: 1933,
      outputBytes: 14354,
    },
    {
      fixtureId: "textbook-fva-minimized-uptake",
      workloadId: "cobra:fva",
      maxTokenCount: 2,
      maxAtomCount: 95,
      maxStepCount: 191,
      maxOutputItemCount: 95,
      peakRamBytes: 242397184,
      peakVramBytes: null,
      elapsedMs: 1855,
      outputBytes: 13787,
    },
    {
      fixtureId: "textbook-gene-deletion",
      workloadId: "cobra:gene-deletion",
      maxTokenCount: 2,
      maxAtomCount: 95,
      maxStepCount: 138,
      maxOutputItemCount: 137,
      peakRamBytes: 242544640,
      peakVramBytes: null,
      elapsedMs: 1742,
      outputBytes: 14454,
    },
    {
      fixtureId: "textbook-reaction-deletion",
      workloadId: "cobra:reaction-deletion",
      maxTokenCount: 2,
      maxAtomCount: 95,
      maxStepCount: 96,
      maxOutputItemCount: 95,
      peakRamBytes: 242012160,
      peakVramBytes: null,
      elapsedMs: 1635,
      outputBytes: 12914,
    },
    {
      fixtureId: "textbook-gapd-gene-knockout",
      workloadId: "cobra:fba",
      maxTokenCount: 2,
      maxAtomCount: 95,
      maxStepCount: 1,
      maxOutputItemCount: 95,
      peakRamBytes: 241614848,
      peakVramBytes: null,
      elapsedMs: 1359,
      outputBytes: 7237,
    },
    {
      fixtureId: "ijo1366-fba",
      workloadId: "cobra:fba",
      maxTokenCount: 2,
      maxAtomCount: 2583,
      maxStepCount: 1,
      maxOutputItemCount: 2583,
      peakRamBytes: 501895168,
      peakVramBytes: null,
      elapsedMs: 28176,
      outputBytes: 242852,
    },
    {
      fixtureId: "ijo1366-fva",
      workloadId: "cobra:fva",
      maxTokenCount: 2,
      maxAtomCount: 2583,
      maxStepCount: 5167,
      maxOutputItemCount: 2583,
      peakRamBytes: 537391104,
      peakVramBytes: null,
      elapsedMs: 598396,
      outputBytes: 402359,
    },
    {
      fixtureId: "ijo1366-gene-deletion",
      workloadId: "cobra:gene-deletion",
      maxTokenCount: 2,
      maxAtomCount: 2583,
      maxStepCount: 1368,
      maxOutputItemCount: 1367,
      peakRamBytes: 500977664,
      peakVramBytes: null,
      elapsedMs: 181901,
      outputBytes: 298035,
    },
  ],
};
