import type { LiatirHardwareValidationProfile, LiatirValidationResult } from "./structure-simulation.js";

export const MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID = "autodock-vina-molecular-docking" as const;
export const MOLECULAR_DOCKING_BOX_ID = "molecular-docking" as const;
export const MOLECULAR_DOCKING_RUNTIME_ID = "molecular-docking-vina-1-2-7" as const;
export const AUTODOCK_VINA_VERSION = "1.2.7" as const;
export const MEEKO_VERSION = "0.8.0" as const;
export const RINGTAIL_VERSION = "2.3.1" as const;
export const PDBFIXER_VERSION = "1.12.0" as const;

export const RECEPTOR_PREPARATION_TOOL_ID = "docking-receptor-preparation" as const;
export const MOLECULAR_DOCKING_TOOL_ID = "molecular-docking" as const;
export const DOCKED_COMPLEX_TOOL_ID = "docking-selected-complex" as const;

export const MOLECULAR_DOCKING_INTERPRETATION_NOTICE =
  "Vina scores are empirical scoring-function values in kcal/mol used to rank poses. They are not measured binding affinities, free energies or evidence of biological activity, and a docked pose is a hypothesis to test, not a result." as const;

/** AutoDock Vina warns above this search volume; Liatir repeats the warning rather than inventing one. */
export const VINA_LARGE_SEARCH_VOLUME_CUBIC_ANGSTROM = 27_000;
export const VINA_MAX_BOX_SIDE_ANGSTROM = 126;
export const VINA_MAX_SEED = 2_147_483_647;
export const VINA_MAX_EXHAUSTIVENESS = 512;
export const VINA_MAX_POSES = 50;

export type LiatirVinaScoringFunction = "vina" | "vinardo";
export type LiatirVector3 = [number, number, number];

/** Every structural change Receptor Preparation may make is named here; nothing else is removed. */
export interface LiatirReceptorPreparationOptions {
  /** Chains to keep; empty keeps every chain. */
  keepChains: string[];
  removeWaters: boolean;
  /** Residue names (for example a co-crystallized ligand) the user chose to remove. */
  removeResidueNames: string[];
  addMissingAtoms: boolean;
  /** Models internal gaps only; unresolved termini are never built. */
  addMissingResidues: boolean;
  replaceNonstandardResidues: boolean;
  /** Every residue is re-protonated by OpenMM's rules at this pH; input hydrogens are replaced. */
  ph: number;
}

export type LiatirDockingSite =
  | { mode: "box"; center: LiatirVector3; size: LiatirVector3 }
  | { mode: "reference-ligand"; referenceLigand: string; paddingAngstrom: number };

export interface LiatirDockingOptions {
  scoringFunction: LiatirVinaScoringFunction;
  exhaustiveness: number;
  numPoses: number;
  energyRangeKcalPerMol: number;
  minRmsdAngstrom: number;
  seed: number;
  cpu: number;
  /** Adds missing hydrogens to the charge state drawn in the SDF; never re-protonates by pH. */
  addLigandHydrogens: boolean;
}

export const DEFAULT_RECEPTOR_PREPARATION_OPTIONS: LiatirReceptorPreparationOptions = {
  keepChains: [],
  removeWaters: true,
  removeResidueNames: [],
  addMissingAtoms: true,
  addMissingResidues: false,
  replaceNonstandardResidues: false,
  ph: 7.4,
};

export const DEFAULT_DOCKING_OPTIONS: LiatirDockingOptions = {
  scoringFunction: "vina",
  exhaustiveness: 8,
  numPoses: 9,
  energyRangeKcalPerMol: 3,
  minRmsdAngstrom: 1,
  seed: 42,
  cpu: 4,
  addLigandHydrogens: true,
};

const RESIDUE_NAME = /^[A-Za-z0-9]{1,4}$/u;
const CHAIN_ID = /^[A-Za-z0-9]{1,4}$/u;

function result(errors: string[], warnings: string[] = []): LiatirValidationResult {
  return { valid: errors.length === 0, errors, warnings };
}

function integerIn(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function validateReceptorPreparationOptions(
  options: LiatirReceptorPreparationOptions,
): LiatirValidationResult {
  const errors: string[] = [];
  for (const chain of options.keepChains) {
    if (!CHAIN_ID.test(chain)) errors.push(`Chain identifier "${chain}" is not valid.`);
  }
  for (const name of options.removeResidueNames) {
    if (!RESIDUE_NAME.test(name)) errors.push(`Residue name "${name}" is not valid.`);
  }
  if (!Number.isFinite(options.ph) || options.ph < 0 || options.ph > 14) {
    errors.push("Protonation pH must be between 0 and 14.");
  }
  return result(errors);
}

export function validateDockingSite(site: LiatirDockingSite): LiatirValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (site.mode === "box") {
    if (site.center.length !== 3 || !site.center.every(Number.isFinite)) {
      errors.push("The box centre needs three finite coordinates in Å.");
    }
    if (site.size.length !== 3 || !site.size.every((side) => Number.isFinite(side) && side >= 1
      && side <= VINA_MAX_BOX_SIDE_ANGSTROM)) {
      errors.push(`Each box side must be between 1 and ${VINA_MAX_BOX_SIDE_ANGSTROM} Å.`);
    } else if (site.size[0] * site.size[1] * site.size[2] > VINA_LARGE_SEARCH_VOLUME_CUBIC_ANGSTROM) {
      warnings.push(`The search space exceeds ${VINA_LARGE_SEARCH_VOLUME_CUBIC_ANGSTROM.toLocaleString("en-US")} Å³, where Vina warns that searching becomes less reliable; raise exhaustiveness or shrink the box.`);
    }
  } else if (site.mode === "reference-ligand") {
    if (!site.referenceLigand.trim()) errors.push("Choose a reference ligand SDF that marks the binding site.");
    if (!Number.isFinite(site.paddingAngstrom) || site.paddingAngstrom < 0 || site.paddingAngstrom > 30) {
      errors.push("Box padding must be between 0 and 30 Å.");
    }
  } else {
    errors.push("The binding site must be an explicit box or a reference ligand.");
  }
  return result(errors, warnings);
}

export function validateDockingOptions(
  options: LiatirDockingOptions,
  cpuLimit = Number.MAX_SAFE_INTEGER,
): LiatirValidationResult {
  const errors: string[] = [];
  if (options.scoringFunction !== "vina" && options.scoringFunction !== "vinardo") {
    errors.push("The scoring function must be vina or vinardo.");
  }
  if (!integerIn(options.exhaustiveness, 1, VINA_MAX_EXHAUSTIVENESS)) {
    errors.push(`Exhaustiveness must be an integer from 1 through ${VINA_MAX_EXHAUSTIVENESS}.`);
  }
  if (!integerIn(options.numPoses, 1, VINA_MAX_POSES)) {
    errors.push(`Poses per ligand must be an integer from 1 through ${VINA_MAX_POSES}.`);
  }
  if (!Number.isFinite(options.energyRangeKcalPerMol) || options.energyRangeKcalPerMol < 0.1
    || options.energyRangeKcalPerMol > 20) {
    errors.push("Energy range must be between 0.1 and 20 kcal/mol.");
  }
  if (!Number.isFinite(options.minRmsdAngstrom) || options.minRmsdAngstrom < 0.1 || options.minRmsdAngstrom > 10) {
    errors.push("Minimum RMSD between poses must be between 0.1 and 10 Å.");
  }
  if (!integerIn(options.seed, 1, VINA_MAX_SEED)) {
    errors.push(`Seed must be an integer from 1 through ${VINA_MAX_SEED}.`);
  }
  if (!integerIn(options.cpu, 1, cpuLimit)) {
    errors.push(`CPU threads must be an integer from 1 through ${Math.min(cpuLimit, 1024)}.`);
  }
  return result(errors);
}

/** What makes two screening results comparable; the runner stores it in every database it writes. */
export interface LiatirDockingExperimentIdentity {
  schemaVersion: 1;
  receptorPdbqtSha256: string;
  center: LiatirVector3;
  size: LiatirVector3;
  scoringFunction: LiatirVinaScoringFunction;
  exhaustiveness: number;
  vina: string;
  meeko: string;
}

export interface LiatirDockingPoseRow {
  ligand: string;
  inputIndex: number;
  poseRank: number;
  scoreKcalPerMol: number;
  interKcalPerMol: number;
  intraKcalPerMol: number;
  heavyAtoms: number;
  ligandEfficiency: number;
}

/**
 * Every sample is transcribed from the retained record named by `evidenceRecord`, and
 * `tests/unit/phase3-hardware-profiles.test.ts` fails if any value drifts from that file. They come
 * from production release run 42057594343, which measured the very archive it published.
 */
export const MOLECULAR_DOCKING_LINUX_X86_64_CPU_PRODUCTION_PROFILE: LiatirHardwareValidationProfile = {
  schemaVersion: 1,
  profileId: "autodock-vina-molecular-docking-1.2.7-beta.1-linux-x86_64-cpu-production-2026-11-05",
  componentId: MOLECULAR_DOCKING_RUNTIME_COMPONENT_ID,
  componentVersion: AUTODOCK_VINA_VERSION,
  runtimeBoxRelease: "1.2.7-beta.1",
  target: { platform: "linux", arch: "x86_64", accelerator: "cpu" },
  precision: "double",
  measuredAt: "2026-11-05T15:55:50.105Z",
  evidenceRecord: "runtime-boxes/measurements/molecular-docking-linux-x86_64-cpu-production-run-42057594343.json",
  samples: [
    {
      fixtureId: "official-receptor-preparation",
      workloadId: "docking:receptor-preparation",
      maxTokenCount: 1,
      maxAtomCount: 4412,
      maxStepCount: 1,
      maxOutputItemCount: 1,
      peakRamBytes: 355049472,
      peakVramBytes: null,
      elapsedMs: 5706,
      outputBytes: 575355,
    },
    {
      fixtureId: "raw-receptor-preparation",
      workloadId: "docking:receptor-preparation",
      maxTokenCount: 1,
      maxAtomCount: 4710,
      maxStepCount: 1,
      maxOutputItemCount: 1,
      peakRamBytes: 350576640,
      peakVramBytes: null,
      elapsedMs: 4448,
      outputBytes: 612263,
    },
    {
      fixtureId: "official-redocking",
      workloadId: "vina:dock:vina",
      maxTokenCount: 1,
      maxAtomCount: 2702,
      maxStepCount: 32,
      maxOutputItemCount: 9,
      peakRamBytes: 946958336,
      peakVramBytes: null,
      elapsedMs: 72225,
      outputBytes: 184243,
    },
    {
      fixtureId: "prepared-redocking",
      workloadId: "vina:dock:vina",
      maxTokenCount: 1,
      maxAtomCount: 2702,
      maxStepCount: 32,
      maxOutputItemCount: 9,
      peakRamBytes: 946028544,
      peakVramBytes: null,
      elapsedMs: 70867,
      outputBytes: 541666,
    },
    {
      fixtureId: "raw-structure-redocking",
      workloadId: "vina:dock:vina",
      maxTokenCount: 1,
      maxAtomCount: 2706,
      maxStepCount: 32,
      maxOutputItemCount: 9,
      peakRamBytes: 946569216,
      peakVramBytes: null,
      elapsedMs: 74397,
      outputBytes: 548471,
    },
    {
      fixtureId: "select-complex",
      workloadId: "docking:select-complex",
      maxTokenCount: 1,
      maxAtomCount: 4411,
      maxStepCount: 1,
      maxOutputItemCount: 1,
      peakRamBytes: 62570496,
      peakVramBytes: null,
      elapsedMs: 165,
      outputBytes: 370853,
    },
    {
      fixtureId: "reproducibility-repeat-a",
      workloadId: "vina:dock:vina",
      maxTokenCount: 1,
      maxAtomCount: 2702,
      maxStepCount: 8,
      maxOutputItemCount: 9,
      peakRamBytes: 946417664,
      peakVramBytes: null,
      elapsedMs: 25825,
      outputBytes: 177786,
    },
    {
      fixtureId: "reproducibility-repeat-b",
      workloadId: "vina:dock:vina",
      maxTokenCount: 1,
      maxAtomCount: 2702,
      maxStepCount: 8,
      maxOutputItemCount: 9,
      peakRamBytes: 946372608,
      peakVramBytes: null,
      elapsedMs: 26526,
      outputBytes: 177786,
    },
    {
      fixtureId: "reproducibility-repeat-one-thread",
      workloadId: "vina:dock:vina",
      maxTokenCount: 1,
      maxAtomCount: 2702,
      maxStepCount: 8,
      maxOutputItemCount: 9,
      peakRamBytes: 945954816,
      peakVramBytes: null,
      elapsedMs: 89514,
      outputBytes: 177794,
    },
    {
      fixtureId: "batch-screen",
      workloadId: "vina:dock:vina",
      maxTokenCount: 9,
      maxAtomCount: 2702,
      maxStepCount: 8,
      maxOutputItemCount: 81,
      peakRamBytes: 1246687232,
      peakVramBytes: null,
      elapsedMs: 102120,
      outputBytes: 753785,
    },
    {
      fixtureId: "append-same-experiment",
      workloadId: "vina:dock:vina",
      maxTokenCount: 1,
      maxAtomCount: 2702,
      maxStepCount: 8,
      maxOutputItemCount: 9,
      peakRamBytes: 817097728,
      peakVramBytes: null,
      elapsedMs: 6498,
      outputBytes: 288895,
    },
  ],
};

/** Vina returns poses best-first: within one ligand, rank 1 holds the lowest score. */
export function validateDockingPoseRows(rows: LiatirDockingPoseRow[]): LiatirValidationResult {
  const errors: string[] = [];
  const byLigand = new Map<string, LiatirDockingPoseRow[]>();
  for (const row of rows) {
    if (![row.scoreKcalPerMol, row.interKcalPerMol, row.intraKcalPerMol, row.ligandEfficiency].every(Number.isFinite)) {
      errors.push(`Pose ${row.poseRank} of ${row.ligand} has a non-finite score.`);
    }
    if (!integerIn(row.heavyAtoms, 1, Number.MAX_SAFE_INTEGER)) {
      errors.push(`${row.ligand} has no heavy atoms recorded.`);
    }
    byLigand.set(row.ligand, [...(byLigand.get(row.ligand) ?? []), row]);
  }
  for (const [ligand, poses] of byLigand) {
    const ordered = [...poses].sort((left, right) => left.poseRank - right.poseRank);
    ordered.forEach((pose, index) => {
      if (pose.poseRank !== index + 1) errors.push(`${ligand} pose ranks are not consecutive from 1.`);
      if (index > 0 && pose.scoreKcalPerMol < ordered[index - 1].scoreKcalPerMol) {
        errors.push(`${ligand} pose ${pose.poseRank} scores better than a higher-ranked pose.`);
      }
    });
  }
  if (rows.length === 0) errors.push("No docked pose was returned.");
  return result([...new Set(errors)]);
}
