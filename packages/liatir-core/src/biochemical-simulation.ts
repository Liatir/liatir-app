import type { LiatirHardwareValidationProfile, LiatirValidationResult } from "./structure-simulation.js";

export const BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID = "pysb-biochemical-simulation" as const;
export const BIOCHEMICAL_SIMULATION_BOX_ID = "biochemical-simulation" as const;
export const BIOCHEMICAL_SIMULATION_RUNTIME_ID = "biochemical-simulation-pysb-1-17-0" as const;
export const PYSB_VERSION = "1.17.0" as const;
export const BIONETGEN_VERSION = "2.9.3" as const;

export const BIOCHEMICAL_SIMULATION_TOOL_ID = "biochemical-simulation" as const;

/** The runner writes the same sentence into every summary; a unit test holds the two equal. */
export const BIOCHEMICAL_SIMULATION_INTERPRETATION_NOTICE =
  "A simulation describes the model's reactions, rate laws and parameters, not the cell they stand for. Deterministic results assume well-mixed, large populations; stochastic results are samples whose statistics depend on the number of runs." as const;

/**
 * Reviewed models that ship inside PySB 1.17.0, in the runner's order. They are Python, so a user
 * cannot add one: a user's own model comes as declarative BNGL.
 */
export const BIOCHEMICAL_BUILTIN_MODELS = {
  robertson: "Robertson's stiff chemical kinetics problem",
  synth_deg: "Synthesis and first-order degradation of one species",
  michment: "Michaelis-Menten enzyme kinetics",
  tyson_oscillator: "Tyson's cell-cycle oscillator",
  kinase_cascade: "A three-tier kinase cascade",
  earm_1_0: "Extrinsic apoptosis reaction model 1.0 (Albeck et al. 2008)",
  bngwiki_egfr_simple: "A simple EGFR signalling model from the BioNetGen tutorial",
  schloegl: "Schlögl's bistable reaction network",
} as const;
export type LiatirBiochemicalBuiltinModel = keyof typeof BIOCHEMICAL_BUILTIN_MODELS;

export const BIOCHEMICAL_METHODS = ["ode", "ssa"] as const;
export type LiatirBiochemicalMethod = (typeof BIOCHEMICAL_METHODS)[number];

export const BIOCHEMICAL_MAX_POINTS = 10_001;
export const BIOCHEMICAL_MAX_RUNS = 10_000;
/** BioNetGen's SSA takes a signed 32-bit seed, and replicate i uses seed + i. */
export const BIOCHEMICAL_MAX_SEED = 2_147_483_647;
export const BIOCHEMICAL_MAX_TIME = 1e12;
export const BIOCHEMICAL_MAX_PARAMETER_CHANGES = 1_000;

export interface LiatirParameterChange {
  name: string;
  value: number;
}

export interface LiatirBiochemicalSimulationOptions {
  /** ode: deterministic integration with LSODA; ssa: Gillespie's stochastic simulation in BioNetGen. */
  method: LiatirBiochemicalMethod;
  /** The simulated time, in the model's own time unit. */
  tEnd: number;
  /** Output times, the start included. */
  points: number;
  /** Log spacing resolves a stiff system's fast start; deterministic runs only. */
  spacing: "linear" | "log";
  /** The first output time after the start of a log-spaced series; absent, a millionth of tEnd. */
  tFirst?: number;
  rtol: number;
  atol: number;
  /** Stochastic replicates; replicate i uses seed + i, so every one differs and each can be repeated. */
  runs: number;
  seed: number;
  parameters: LiatirParameterChange[];
}

export const DEFAULT_BIOCHEMICAL_SIMULATION_OPTIONS: LiatirBiochemicalSimulationOptions = {
  method: "ode",
  tEnd: 100,
  points: 101,
  spacing: "linear",
  rtol: 1e-8,
  atol: 1e-12,
  runs: 100,
  seed: 1,
  parameters: [],
};

function within(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function validateBiochemicalSimulationOptions(options: LiatirBiochemicalSimulationOptions): LiatirValidationResult {
  const errors: string[] = [];
  if (!BIOCHEMICAL_METHODS.includes(options.method)) errors.push("The method must be ode (deterministic) or ssa (stochastic).");
  if (!within(options.tEnd, 0, BIOCHEMICAL_MAX_TIME) || options.tEnd <= 0) {
    errors.push(`The end time must be positive and at most ${BIOCHEMICAL_MAX_TIME}.`);
  }
  if (!Number.isInteger(options.points) || !within(options.points, 2, BIOCHEMICAL_MAX_POINTS)) {
    errors.push(`Output points must be a whole number from 2 to ${BIOCHEMICAL_MAX_POINTS.toLocaleString("en-US")}.`);
  }
  if (options.spacing !== "linear" && options.spacing !== "log") errors.push("Time spacing must be linear or log.");
  if (options.spacing === "log") {
    if (options.method === "ssa") errors.push("Stochastic runs report evenly spaced times; choose linear spacing.");
    if (options.tFirst !== undefined && !(options.tFirst > 0 && options.tFirst < options.tEnd)) {
      errors.push("The first output time of a log-spaced series must lie between zero and the end time.");
    }
  }
  if (options.method === "ode") {
    if (!within(options.rtol, 1e-14, 1e-3)) errors.push("The relative tolerance must be between 1e-14 and 1e-3.");
    if (!within(options.atol, 1e-30, 1e-3)) errors.push("The absolute tolerance must be between 1e-30 and 1e-3.");
  } else {
    if (!Number.isInteger(options.runs) || !within(options.runs, 1, BIOCHEMICAL_MAX_RUNS)) {
      errors.push(`Stochastic runs must be a whole number from 1 to ${BIOCHEMICAL_MAX_RUNS.toLocaleString("en-US")}.`);
    } else if (!Number.isInteger(options.seed) || !within(options.seed, 1, BIOCHEMICAL_MAX_SEED - options.runs + 1)) {
      errors.push(`The seed must be a whole number from 1 to ${BIOCHEMICAL_MAX_SEED - options.runs + 1}, so that every run's seed fits.`);
    }
  }
  if (options.parameters.length > BIOCHEMICAL_MAX_PARAMETER_CHANGES) {
    errors.push(`Change at most ${BIOCHEMICAL_MAX_PARAMETER_CHANGES} parameters.`);
  }
  const seen = new Set<string>();
  for (const change of options.parameters) {
    if (!change.name) errors.push("Every parameter change needs a name.");
    else if (seen.has(change.name)) errors.push(`The parameter ${change.name} is changed twice.`);
    seen.add(change.name);
    if (!Number.isFinite(change.value)) errors.push(`The new value of ${change.name || "a parameter"} must be a finite number.`);
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

/** Parameter changes written one per line as `name value`, for example `kA_syn 2`. */
export function parseParameterChanges(text: string): LiatirParameterChange[] {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const parts = line.split(/[\s,;=]+/u);
    if (parts.length !== 2) throw new Error(`Parameter line ${index + 1} must read: name value.`);
    return { name: parts[0], value: Number(parts[1]) };
  });
}

/**
 * Every sample is transcribed from the retained record named by `evidenceRecord`, and
 * `tests/unit/phase3-hardware-profiles.test.ts` fails if any value drifts from that file. Tokens are
 * reactions and atoms are species of the generated network; steps are output times across all runs.
 * A development measurement stays valid only for this release identity; a production build is re-measured.
 */
export const BIOCHEMICAL_SIMULATION_LINUX_X86_64_CPU_DEVELOPMENT_PROFILE: LiatirHardwareValidationProfile = {
  schemaVersion: 1,
  profileId: "pysb-biochemical-simulation-1.17.0-beta.1-linux-x86_64-cpu-development-2026-11-05",
  componentId: BIOCHEMICAL_SIMULATION_RUNTIME_COMPONENT_ID,
  componentVersion: PYSB_VERSION,
  runtimeBoxRelease: "1.17.0-beta.1",
  target: { platform: "linux", arch: "x86_64", accelerator: "cpu" },
  precision: "double",
  measuredAt: "2026-11-05T10:55:42.431Z",
  evidenceRecord: "runtime-boxes/measurements/biochemical-simulation-linux-x86_64-cpu-development-2026-11-05.json",
  samples: [
    {
      fixtureId: "robertson-ode",
      workloadId: "pysb:ode",
      maxTokenCount: 3,
      maxAtomCount: 3,
      maxStepCount: 81,
      maxOutputItemCount: 243,
      peakRamBytes: 155664384,
      peakVramBytes: null,
      elapsedMs: 1530,
      outputBytes: 21032,
    },
    {
      fixtureId: "synthesis-degradation-ode",
      workloadId: "pysb:ode",
      maxTokenCount: 2,
      maxAtomCount: 1,
      maxStepCount: 51,
      maxOutputItemCount: 51,
      peakRamBytes: 136241152,
      peakVramBytes: null,
      elapsedMs: 1036,
      outputBytes: 4882,
    },
    {
      fixtureId: "synthesis-degradation-ssa",
      workloadId: "pysb:ssa",
      maxTokenCount: 2,
      maxAtomCount: 1,
      maxStepCount: 201000,
      maxOutputItemCount: 201000,
      peakRamBytes: 163328000,
      peakVramBytes: null,
      elapsedMs: 9199,
      outputBytes: 3196426,
    },
    {
      fixtureId: "synthesis-degradation-ssa-repeat",
      workloadId: "pysb:ssa",
      maxTokenCount: 2,
      maxAtomCount: 1,
      maxStepCount: 201000,
      maxOutputItemCount: 201000,
      peakRamBytes: 163127296,
      peakVramBytes: null,
      elapsedMs: 9451,
      outputBytes: 3196426,
    },
    {
      fixtureId: "egfr-net-ode",
      workloadId: "pysb:ode",
      maxTokenCount: 3749,
      maxAtomCount: 356,
      maxStepCount: 101,
      maxOutputItemCount: 1515,
      peakRamBytes: 172396544,
      peakVramBytes: null,
      elapsedMs: 27927,
      outputBytes: 264089,
    },
    {
      fixtureId: "bngl-actions-ignored",
      workloadId: "pysb:ode",
      maxTokenCount: 30,
      maxAtomCount: 15,
      maxStepCount: 11,
      maxOutputItemCount: 33,
      peakRamBytes: 137256960,
      peakVramBytes: null,
      elapsedMs: 1137,
      outputBytes: 8756,
    },
  ],
};
