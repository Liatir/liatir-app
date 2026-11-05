import type { LiatirHardwareValidationProfile, LiatirValidationResult } from "./structure-simulation.js";

export const MOLECULAR_ANALYSIS_RUNTIME_COMPONENT_ID = "mdanalysis-molecular-analysis" as const;
export const MOLECULAR_ANALYSIS_BOX_ID = "molecular-analysis" as const;
export const MOLECULAR_ANALYSIS_RUNTIME_ID = "molecular-analysis-mdanalysis-2-11-0" as const;
export const MDANALYSIS_VERSION = "2.11.0" as const;
export const PROLIF_VERSION = "2.2.3" as const;

export const TRAJECTORY_ANALYSIS_TOOL_ID = "trajectory-analysis" as const;
export const INTERACTION_FINGERPRINT_TOOL_ID = "interaction-fingerprint" as const;

/** The runner writes the same sentence into every summary; a unit test holds the two equal. */
export const MOLECULAR_ANALYSIS_INTERPRETATION_NOTICE =
  "Trajectory measures describe the simulation that produced the trajectory, under its force field and sampling; they are not experimental observations. A detected interaction is a geometric criterion met in a frame or pose, not a measured binding contribution." as const;

/** ProLIF 2.2.3's default interactions, in its own order. */
export const PROLIF_DEFAULT_INTERACTIONS = [
  "Hydrophobic", "HBDonor", "HBAcceptor", "PiStacking", "Anionic", "Cationic", "CationPi", "PiCation", "VdWContact",
] as const;

/**
 * Every explicit-hydrogen interaction ProLIF detects without extra inputs. The implicit-hydrogen
 * variants exist for structures without hydrogens, which the runner refuses, and water bridges need
 * a water selection this tool does not take.
 */
export const PROLIF_OFFERED_INTERACTIONS = [
  ...PROLIF_DEFAULT_INTERACTIONS, "FaceToFace", "EdgeToFace", "XBDonor", "XBAcceptor", "MetalDonor", "MetalAcceptor",
] as const;

export type LiatirProlifInteraction = (typeof PROLIF_OFFERED_INTERACTIONS)[number];

export const MOLECULAR_ANALYSIS_MAX_SERIES = 16;
export const MOLECULAR_ANALYSIS_MAX_SELECTION_CHARACTERS = 512;

/** Frames are counted from 0; `stop` is exclusive and `null` means the last frame. */
export interface LiatirFrameWindow {
  start: number;
  stop: number | null;
  stride: number;
}

/** Atom selections use MDAnalysis's selection language, which is parsed, never evaluated as code. */
export interface LiatirRmsdMeasurement {
  label: string;
  selection: string;
}

export interface LiatirDistanceMeasurement {
  label: string;
  selectionA: string;
  selectionB: string;
}

export interface LiatirTrajectoryAnalysisOptions extends LiatirFrameWindow {
  /** Every frame is superposed on the first analysed frame by these atoms before anything is measured. */
  fitSelection: string;
  rmsd: LiatirRmsdMeasurement[];
  rmsf: { selection: string } | null;
  distances: LiatirDistanceMeasurement[];
}

export interface LiatirInteractionFingerprintOptions extends LiatirFrameWindow {
  /** Read only for a trajectory; a docked pose file is its own ligand. */
  ligandSelection: string;
  proteinSelection: string;
  interactions: LiatirProlifInteraction[];
}

export type LiatirInteractionFingerprintSource = "trajectory" | "poses";

export const DEFAULT_TRAJECTORY_ANALYSIS_OPTIONS: LiatirTrajectoryAnalysisOptions = {
  fitSelection: "protein and name CA",
  rmsd: [{ label: "Protein C-alpha", selection: "protein and name CA" }],
  rmsf: { selection: "protein and name CA" },
  distances: [],
  start: 0,
  stop: null,
  stride: 1,
};

export const DEFAULT_INTERACTION_FINGERPRINT_OPTIONS: LiatirInteractionFingerprintOptions = {
  ligandSelection: "",
  proteinSelection: "protein",
  interactions: [...PROLIF_DEFAULT_INTERACTIONS],
  start: 0,
  stop: null,
  stride: 1,
};

/** A ligand residue the runner's preflight found in a topology, with the selection that picks it. */
export interface LiatirLigandCandidate {
  residueName: string;
  chain: string;
  residueNumber: string;
  atoms: number;
  hydrogens: number;
  bondRecords: boolean;
  selection: string;
}

function result(errors: string[], warnings: string[] = []): LiatirValidationResult {
  return { valid: errors.length === 0, errors, warnings };
}

function selectionErrors(value: string, label: string): string[] {
  const text = value.trim();
  if (!text) return [`${label} needs an atom selection.`];
  if (text.length > MOLECULAR_ANALYSIS_MAX_SELECTION_CHARACTERS) {
    return [`${label} is longer than ${MOLECULAR_ANALYSIS_MAX_SELECTION_CHARACTERS} characters.`];
  }
  return [];
}

function windowErrors(window: LiatirFrameWindow): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(window.start) || window.start < 0) errors.push("The first frame must be 0 or more.");
  if (window.stop !== null && (!Number.isSafeInteger(window.stop) || window.stop <= window.start)) {
    errors.push("The frame range must end after its first frame.");
  }
  if (!Number.isSafeInteger(window.stride) || window.stride < 1) errors.push("The frame step must be 1 or more.");
  return errors;
}

export function validateTrajectoryAnalysisOptions(options: LiatirTrajectoryAnalysisOptions): LiatirValidationResult {
  const errors = [...selectionErrors(options.fitSelection, "The superposition"), ...windowErrors(options)];
  const labels = new Set<string>();
  const label = (value: string) => {
    const text = value.trim().replace(/\s+/gu, " ");
    if (!text || text.length > 64) errors.push("Every measurement needs a name of 1 to 64 characters.");
    else if (labels.has(text.toLowerCase())) errors.push(`Two measurements are both named ${text}.`);
    labels.add(text.toLowerCase());
  };
  for (const item of options.rmsd) {
    label(item.label);
    errors.push(...selectionErrors(item.selection, `RMSD ${item.label}`));
  }
  for (const item of options.distances) {
    label(item.label);
    errors.push(...selectionErrors(item.selectionA, `Distance ${item.label}`),
      ...selectionErrors(item.selectionB, `Distance ${item.label}`));
  }
  if (options.rmsf) errors.push(...selectionErrors(options.rmsf.selection, "RMSF"));
  if (options.rmsd.length > MOLECULAR_ANALYSIS_MAX_SERIES || options.distances.length > MOLECULAR_ANALYSIS_MAX_SERIES) {
    errors.push(`Choose at most ${MOLECULAR_ANALYSIS_MAX_SERIES} RMSD and ${MOLECULAR_ANALYSIS_MAX_SERIES} distance measurements.`);
  }
  if (!options.rmsd.length && !options.distances.length && !options.rmsf) errors.push("Choose at least one measurement.");
  return result([...new Set(errors)]);
}

export function validateInteractionFingerprintOptions(
  options: LiatirInteractionFingerprintOptions,
  source: LiatirInteractionFingerprintSource,
): LiatirValidationResult {
  const errors = [...selectionErrors(options.proteinSelection, "The protein")];
  if (source === "trajectory") errors.push(...selectionErrors(options.ligandSelection, "The ligand"), ...windowErrors(options));
  const offered = new Set<string>(PROLIF_OFFERED_INTERACTIONS);
  if (!options.interactions.length) errors.push("Choose at least one interaction.");
  for (const name of options.interactions) {
    if (!offered.has(name)) errors.push(`${name} is not an interaction this tool detects.`);
  }
  return result(errors);
}

/**
 * Every sample is transcribed from the retained record named by `evidenceRecord`, and
 * `tests/unit/phase3-hardware-profiles.test.ts` fails if any value drifts from that file. They come
 * from production release run 42063057536, which measured the very archive it published.
 */
export const MOLECULAR_ANALYSIS_LINUX_X86_64_CPU_PRODUCTION_PROFILE: LiatirHardwareValidationProfile = {
  schemaVersion: 1,
  profileId: "mdanalysis-molecular-analysis-2.11.0-beta.1-linux-x86_64-cpu-production-2026-11-05",
  componentId: MOLECULAR_ANALYSIS_RUNTIME_COMPONENT_ID,
  componentVersion: MDANALYSIS_VERSION,
  runtimeBoxRelease: "2.11.0-beta.1",
  target: { platform: "linux", arch: "x86_64", accelerator: "cpu" },
  precision: "double",
  measuredAt: "2026-11-05T16:30:55.449Z",
  evidenceRecord: "runtime-boxes/measurements/molecular-analysis-linux-x86_64-cpu-production-run-42063057536.json",
  samples: [
    {
      fixtureId: "reference-trajectory-analysis-xtc",
      workloadId: "mdanalysis:trajectory-analysis",
      maxTokenCount: 5,
      maxAtomCount: 5067,
      maxStepCount: 250,
      maxOutputItemCount: 250,
      peakRamBytes: 158564352,
      peakVramBytes: null,
      elapsedMs: 2977,
      outputBytes: 74914,
    },
    {
      fixtureId: "reference-trajectory-analysis-dcd",
      workloadId: "mdanalysis:trajectory-analysis",
      maxTokenCount: 5,
      maxAtomCount: 5067,
      maxStepCount: 250,
      maxOutputItemCount: 250,
      peakRamBytes: 155742208,
      peakVramBytes: null,
      elapsedMs: 2926,
      outputBytes: 78462,
    },
    {
      fixtureId: "reference-trajectory-analysis-strided",
      workloadId: "mdanalysis:trajectory-analysis",
      maxTokenCount: 5,
      maxAtomCount: 5067,
      maxStepCount: 250,
      maxOutputItemCount: 36,
      peakRamBytes: 155090944,
      peakVramBytes: null,
      elapsedMs: 2815,
      outputBytes: 28418,
    },
    {
      fixtureId: "reference-trajectory-analysis-repeat",
      workloadId: "mdanalysis:trajectory-analysis",
      maxTokenCount: 5,
      maxAtomCount: 5067,
      maxStepCount: 250,
      maxOutputItemCount: 250,
      peakRamBytes: 155381760,
      peakVramBytes: null,
      elapsedMs: 3103,
      outputBytes: 74914,
    },
    {
      fixtureId: "reference-trajectory-fingerprint",
      workloadId: "prolif:trajectory-fingerprint",
      maxTokenCount: 9,
      maxAtomCount: 5067,
      maxStepCount: 250,
      maxOutputItemCount: 250,
      peakRamBytes: 281985024,
      peakVramBytes: null,
      elapsedMs: 184872,
      outputBytes: 388555,
    },
    {
      fixtureId: "derived-protein-bonds-trajectory-fingerprint",
      workloadId: "prolif:trajectory-fingerprint",
      maxTokenCount: 9,
      maxAtomCount: 5067,
      maxStepCount: 250,
      maxOutputItemCount: 25,
      peakRamBytes: 272932864,
      peakVramBytes: null,
      elapsedMs: 25877,
      outputBytes: 48407,
    },
    {
      fixtureId: "reference-poses-fingerprint",
      workloadId: "prolif:pose-fingerprint",
      maxTokenCount: 9,
      maxAtomCount: 4988,
      maxStepCount: 9,
      maxOutputItemCount: 9,
      peakRamBytes: 249692160,
      peakVramBytes: null,
      elapsedMs: 3751,
      outputBytes: 19163,
    },
    {
      fixtureId: "derived-protein-bonds-poses-fingerprint",
      workloadId: "prolif:pose-fingerprint",
      maxTokenCount: 9,
      maxAtomCount: 4988,
      maxStepCount: 9,
      maxOutputItemCount: 9,
      peakRamBytes: 247472128,
      peakVramBytes: null,
      elapsedMs: 3398,
      outputBytes: 19171,
    },
  ],
};
