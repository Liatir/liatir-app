import type { LiatirComplexPolymerEntity, LiatirComplexSpec } from "./complex-spec.js";
import { validateLiatirComplexSpec } from "./complex-spec.js";
import { runtimeBoxTargetId, type LiatirRuntimeBoxTarget } from "./runtime-box.js";

export const BOLTZ_2_MODEL_ID = "jwohlwend-boltz-2" as const;
export const PROTENIX_V2_MODEL_ID = "bytedance-protenix-v2" as const;
export const PROTENIX_MINI_DEFAULT_MODEL_ID = "bytedance-protenix-mini-default-v0-5-0" as const;
export const PROTENIX_BASE_V1_MODEL_ID = "bytedance-protenix-base-v1-0-0" as const;
export const OPENMM_RUNTIME_COMPONENT_ID = "openmm-openmm" as const;

export const BOLTZ_2_BOX_ID = "boltz-2" as const;
export const PROTENIX_V2_BOX_ID = "protenix-v2" as const;
export const PROTENIX_MINI_DEFAULT_BOX_ID = "protenix-mini-default-v0-5-0" as const;
export const PROTENIX_BASE_V1_BOX_ID = "protenix-base-v1-0-0" as const;
export const OPENMM_BOX_ID = "openmm" as const;

export const BOLTZ_2_RUNTIME_ID = "structure-boltz-2-2-1" as const;
export const PROTENIX_V2_RUNTIME_ID = "structure-protenix-v2-2-0-0" as const;
export const PROTENIX_MINI_DEFAULT_RUNTIME_ID = "structure-protenix-mini-default-v0-5-0" as const;
export const PROTENIX_BASE_V1_RUNTIME_ID = "structure-protenix-base-v1-0-0" as const;
export const OPENMM_RUNTIME_ID = "molecular-simulation-openmm-8-5-1" as const;

export const BOLTZ_2_VERSION = "2.2.1" as const;
export const PROTENIX_V2_VERSION = "2.0.0" as const;
export const PROTENIX_MINI_DEFAULT_VERSION = "0.5.0" as const;
/** The Protenix package both checkpoints run on; the checkpoint is named by the model id. */
export const PROTENIX_BASE_V1_VERSION = "1.0.0" as const;
export const OPENMM_VERSION = "8.5.1" as const;

export const BIOMOLECULAR_STRUCTURE_PREDICTION_TOOL_ID = "biomolecular-structure-prediction" as const;
export const PROTEIN_LIGAND_AFFINITY_TOOL_ID = "protein-ligand-affinity" as const;
export const MOLECULAR_RELAXATION_TOOL_ID = "molecular-relaxation" as const;
export const MOLECULAR_DYNAMICS_TOOL_ID = "molecular-dynamics" as const;

export type LiatirStructureModelId =
  | typeof BOLTZ_2_MODEL_ID
  | typeof PROTENIX_V2_MODEL_ID
  | typeof PROTENIX_BASE_V1_MODEL_ID
  | typeof PROTENIX_MINI_DEFAULT_MODEL_ID;

export const LIATIR_STRUCTURE_MODEL_IDS: readonly LiatirStructureModelId[] = [
  BOLTZ_2_MODEL_ID,
  PROTENIX_V2_MODEL_ID,
  PROTENIX_BASE_V1_MODEL_ID,
  PROTENIX_MINI_DEFAULT_MODEL_ID,
];

export function isLiatirStructureModelId(value: string): value is LiatirStructureModelId {
  return LIATIR_STRUCTURE_MODEL_IDS.includes(value as LiatirStructureModelId);
}

/**
 * Missing A3M alignments are never interpreted implicitly. Every protein without one must be
 * named here and the lower-accuracy single-sequence mode must be acknowledged by the user.
 */
export interface LiatirStructureMsaSelection {
  singleSequenceEntityIds: string[];
  lowerAccuracyAccepted: boolean;
}

export interface LiatirStructurePredictionRequest {
  modelId: LiatirStructureModelId;
  spec: LiatirComplexSpec;
  msa: LiatirStructureMsaSelection;
  seed: number;
  modelCount: number;
}

export interface LiatirAdapterResult<T> extends LiatirValidationResult {
  input: T | null;
}

export type LiatirBoltzSequence =
  | { protein: { id: string | string[]; sequence: string; msa: string } }
  | { dna: { id: string | string[]; sequence: string } }
  | { rna: { id: string | string[]; sequence: string } }
  | { ligand: { id: string | string[]; smiles: string } }
  | { ligand: { id: string | string[]; ccd: string } };

export interface LiatirBoltzInput {
  version: 1;
  sequences: LiatirBoltzSequence[];
  constraints?: Array<Record<string, unknown>>;
  templates?: Array<Record<string, unknown>>;
  properties?: [{ affinity: { binder: string } }];
}

export interface LiatirProtenixInput {
  name: string;
  sequences: Array<Record<string, Record<string, unknown>>>;
  covalent_bonds?: Array<Record<string, string | number>>;
}

export interface LiatirProtenixAdapterOutput {
  document: [LiatirProtenixInput];
  useMsa: boolean;
  useTemplate: boolean;
}

export interface LiatirValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const UINT32_MAX = 0xffff_ffff;
/** Bounds descriptor expansion in authoring, independent of the smaller measured execution limits. */
export const LIATIR_STRUCTURE_MAX_CHAIN_DESCRIPTORS = 4096;

function validSeed(seed: number): boolean {
  return Number.isSafeInteger(seed) && seed >= 0 && seed <= UINT32_MAX;
}

/** Validate shared structure inputs before any model or checkpoint is loaded. */
export function validateStructurePredictionRequest(
  request: LiatirStructurePredictionRequest,
): LiatirValidationResult {
  const complex = validateLiatirComplexSpec(request.spec);
  const errors = [...complex.errors];
  const warnings: string[] = [];
  const chainCount = request.spec.entities.reduce((total, entity) => total + (entity.copies ?? 1), 0);
  if (!Number.isSafeInteger(chainCount) || chainCount > LIATIR_STRUCTURE_MAX_CHAIN_DESCRIPTORS) {
    errors.push(`Complex input exceeds the editor's ${LIATIR_STRUCTURE_MAX_CHAIN_DESCRIPTORS} chain-description limit.`);
  }

  // Copy expansion must not make two distinct entities own the same output chain.
  // Check the suffix arithmetically: validation must not allocate one item per requested copy.
  const entitiesById = new Map(request.spec.entities.map((entity) => [entity.id, entity]));
  for (const entity of request.spec.entities) {
    if ((entity.copies ?? 1) !== 1) continue;
    const match = /^(.*)_([1-9][0-9]*)$/.exec(entity.id);
    if (!match) continue;
    const parent = entitiesById.get(match[1]);
    const copyNumber = Number(match[2]);
    if (parent && (parent.copies ?? 1) > 1 && copyNumber <= parent.copies!
      && String(copyNumber) === match[2]) {
      errors.push(`Entity ${entity.id} conflicts with a generated copy of entity ${parent.id}; choose a different entity id.`);
    }
  }

  if (!isLiatirStructureModelId(request.modelId)) {
    errors.push(`Unsupported structure model: ${String(request.modelId)}.`);
  }
  if (!validSeed(request.seed)) errors.push("Seed must be an integer from 0 through 4294967295.");
  if (!Number.isSafeInteger(request.modelCount) || request.modelCount < 1) {
    errors.push("Model count must be a positive integer.");
  }

  const proteins = request.spec.entities.filter(
    (entity): entity is LiatirComplexPolymerEntity => entity.type === "protein",
  );
  if (proteins.length === 0) errors.push("Structure prediction requires at least one protein entity.");
  const proteinsById = new Map(proteins.map((entity) => [entity.id, entity]));
  const selected = new Set<string>();

  for (const entityId of request.msa.singleSequenceEntityIds) {
    if (selected.has(entityId)) {
      errors.push(`Single-sequence entity ${entityId} is listed more than once.`);
      continue;
    }
    selected.add(entityId);
    const protein = proteinsById.get(entityId);
    if (!protein) {
      errors.push(`Single-sequence entity ${entityId} is not a protein in this complex.`);
    } else if (protein.msa) {
      errors.push(`Protein ${entityId} already has a local A3M alignment and cannot also use single-sequence mode.`);
    }
  }

  for (const protein of proteins) {
    if (!protein.msa && !selected.has(protein.id)) {
      errors.push(`Protein ${protein.id} has no local A3M; explicitly select single-sequence mode to continue.`);
    }
  }
  if (selected.size > 0 && !request.msa.lowerAccuracyAccepted) {
    errors.push("Single-sequence mode requires acknowledging its lower expected accuracy.");
  }
  if (selected.size > 0) {
    warnings.push("Single-sequence prediction can be less accurate than prediction with a suitable local A3M alignment.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

function normalizedSequence(sequence: string): string {
  return sequence.replace(/\s/g, "").toUpperCase();
}

function entityChainIds(entityId: string, copies = 1): string[] {
  if (copies === 1) return [entityId];
  return Array.from({ length: copies }, (_, index) => `${entityId}_${index + 1}`);
}

function boltzEntityId(entityId: string, copies = 1): string | string[] {
  const ids = entityChainIds(entityId, copies);
  return ids.length === 1 ? ids[0] : ids;
}

function adapterFailure<T>(validation: LiatirValidationResult, errors: string[]): LiatirAdapterResult<T> {
  const allErrors = [...validation.errors, ...errors];
  return { valid: false, errors: allErrors, warnings: validation.warnings, input: null };
}

function constraintEntity(
  spec: LiatirComplexSpec,
  entityId: string,
): LiatirComplexSpec["entities"][number] | undefined {
  return spec.entities.find((entity) => entity.id === entityId);
}

function boltzConstraintToken(
  spec: LiatirComplexSpec,
  ref: { entityId: string; residue?: number; atom?: string },
  label: string,
  errors: string[],
): [string, number | string] | null {
  const entity = constraintEntity(spec, ref.entityId);
  if (!entity) return null;
  if ((entity.copies ?? 1) !== 1) {
    errors.push(`${label} cannot address entity ${entity.id} because it has multiple copies.`);
    return null;
  }
  if (entity.type === "ligand") {
    if (!ref.atom) {
      errors.push(`${label} must name an atom for ligand ${entity.id}.`);
      return null;
    }
    return [entity.id, ref.atom];
  }
  if (!ref.residue) {
    errors.push(`${label} must name a residue for polymer ${entity.id}.`);
    return null;
  }
  return [entity.id, ref.atom ?? ref.residue];
}

function boltzBondAtom(
  spec: LiatirComplexSpec,
  ref: { entityId: string; residue?: number; atom?: string },
  label: string,
  errors: string[],
): [string, number, string] | null {
  const entity = constraintEntity(spec, ref.entityId);
  if (!entity) return null;
  if ((entity.copies ?? 1) !== 1) {
    errors.push(`${label} cannot address entity ${entity.id} because it has multiple copies.`);
    return null;
  }
  const residue = ref.residue ?? (entity.type === "ligand" ? 1 : undefined);
  if (!residue || !ref.atom) {
    errors.push(`${label} must name both a residue and atom; ligand residue defaults to 1.`);
    return null;
  }
  return [entity.id, residue, ref.atom];
}

/** Translate the neutral complex contract into Boltz-2's documented YAML object. */
export function adaptBoltz2Input(
  request: LiatirStructurePredictionRequest,
  affinityLigandId?: string,
): LiatirAdapterResult<LiatirBoltzInput> {
  const validation = validateStructurePredictionRequest(request);
  if (!validation.valid) return adapterFailure(validation, []);
  const errors: string[] = [];
  if (request.modelId !== BOLTZ_2_MODEL_ID) errors.push("Boltz adapter requires the Boltz-2 model.");
  const singleSequenceIds = new Set(request.msa.singleSequenceEntityIds);
  const sequences: LiatirBoltzSequence[] = request.spec.entities.map((entity) => {
    const id = boltzEntityId(entity.id, entity.copies);
    if (entity.type === "protein") {
      return { protein: { id, sequence: normalizedSequence(entity.sequence), msa: entity.msa?.path ?? (singleSequenceIds.has(entity.id) ? "empty" : "") } };
    }
    if (entity.type === "dna") return { dna: { id, sequence: normalizedSequence(entity.sequence) } };
    if (entity.type === "rna") return { rna: { id, sequence: normalizedSequence(entity.sequence) } };
    if (entity.type === "ligand") {
      return entity.smiles
        ? { ligand: { id, smiles: entity.smiles } }
        : { ligand: { id, ccd: entity.ccdCode ?? "" } };
    }
    throw new Error(`Unsupported complex entity type: ${String(entity.type)}.`);
  });

  const constraints: Array<Record<string, unknown>> = [];
  for (const [index, constraint] of (request.spec.constraints ?? []).entries()) {
    if (constraint.type === "bond") {
      const atom1 = boltzBondAtom(request.spec, constraint.left, `Bond ${index + 1} left side`, errors);
      const atom2 = boltzBondAtom(request.spec, constraint.right, `Bond ${index + 1} right side`, errors);
      if (atom1 && atom2) constraints.push({ bond: { atom1, atom2 } });
      continue;
    }
    const maxDistance = constraint.maxDistanceAngstrom ?? 6;
    if (maxDistance < 4 || maxDistance > 20) {
      errors.push(`Constraint ${index + 1} maximum distance must be between 4 and 20 angstroms for Boltz-2.`);
      continue;
    }
    if (constraint.type === "distance" && (constraint.minDistanceAngstrom ?? 0) > 0) {
      errors.push(`Constraint ${index + 1} has a minimum distance that Boltz-2 contact constraints cannot represent.`);
      continue;
    }
    const token1 = boltzConstraintToken(request.spec, constraint.left, `Constraint ${index + 1} left side`, errors);
    const token2 = boltzConstraintToken(request.spec, constraint.right, `Constraint ${index + 1} right side`, errors);
    if (token1 && token2) constraints.push({ contact: { token1, token2, max_distance: maxDistance, force: false } });
  }

  const templates: Array<Record<string, unknown>> = [];
  for (const template of request.spec.templates ?? []) {
    if (template.format !== "pdb" && template.format !== "mmcif") {
      errors.push(`Template ${template.id} uses ${template.format}; Boltz-2 accepts only local PDB or mmCIF templates.`);
      continue;
    }
    const entity = constraintEntity(request.spec, template.entityId);
    if (!entity || entity.type !== "protein") {
      errors.push(`Template ${template.id} must reference a protein entity for Boltz-2.`);
      continue;
    }
    const targetIds = boltzEntityId(entity.id, entity.copies);
    const record: Record<string, unknown> = {
      [template.format === "mmcif" ? "cif" : "pdb"]: template.path,
      chain_id: targetIds,
    };
    if (template.chainId) record.template_id = template.chainId;
    templates.push(record);
  }

  let properties: LiatirBoltzInput["properties"];
  if (affinityLigandId !== undefined) {
    const binder = constraintEntity(request.spec, affinityLigandId);
    if (!binder || binder.type !== "ligand") {
      errors.push(`Affinity binder ${affinityLigandId} is not a ligand in this complex.`);
    } else if ((binder.copies ?? 1) !== 1) {
      errors.push("Boltz-2 affinity accepts only one copy of the ligand binder.");
    } else {
      properties = [{ affinity: { binder: binder.id } }];
    }
  }

  if (!validation.valid || errors.length > 0) return adapterFailure(validation, errors);
  return {
    valid: true,
    errors: [],
    warnings: validation.warnings,
    input: {
      version: 1,
      sequences,
      ...(constraints.length ? { constraints } : {}),
      ...(templates.length ? { templates } : {}),
      ...(properties ? { properties } : {}),
    },
  };
}

function protenixConstraintSide(
  spec: LiatirComplexSpec,
  ref: { entityId: string; residue?: number; atom?: string },
  side: 1 | 2,
  errors: string[],
): Record<string, string | number> | null {
  const index = spec.entities.findIndex((entity) => entity.id === ref.entityId);
  const entity = spec.entities[index];
  if (!entity) return null;
  if ((entity.copies ?? 1) !== 1) {
    errors.push(`Covalent bond cannot address entity ${entity.id} because it has multiple copies.`);
    return null;
  }
  const position = ref.residue ?? (entity.type === "ligand" ? 1 : undefined);
  if (!position || !ref.atom) {
    errors.push(`Covalent bond side ${side} must name both a residue and atom; ligand residue defaults to 1.`);
    return null;
  }
  return {
    [`entity${side}`]: String(index + 1),
    [`copy${side}`]: 1,
    [`position${side}`]: String(position),
    [`atom${side}`]: ref.atom,
  };
}

/** Translate the neutral complex contract into Protenix v2.0's exact top-level JSON list. */
export function adaptProtenixInput(
  request: LiatirStructurePredictionRequest,
): LiatirAdapterResult<LiatirProtenixAdapterOutput> {
  const validation = validateStructurePredictionRequest(request);
  if (!validation.valid) return adapterFailure(validation, []);
  const errors: string[] = [];
  const protenixModels: readonly LiatirStructureModelId[] = [
    PROTENIX_V2_MODEL_ID,
    PROTENIX_BASE_V1_MODEL_ID,
    PROTENIX_MINI_DEFAULT_MODEL_ID,
  ];
  if (!protenixModels.includes(request.modelId)) {
    errors.push("Protenix adapter requires a Protenix model.");
  }
  const mini = request.modelId === PROTENIX_MINI_DEFAULT_MODEL_ID;
  const templatesByEntity = new Map<string, LiatirComplexSpec["templates"]>();
  for (const template of request.spec.templates ?? []) {
    const current = templatesByEntity.get(template.entityId) ?? [];
    current.push(template);
    templatesByEntity.set(template.entityId, current);
  }

  const sequences: LiatirProtenixInput["sequences"] = [];
  let useMsa = false;
  let useTemplate = false;
  for (const entity of request.spec.entities) {
    const count = entity.copies ?? 1;
    const ids = entityChainIds(entity.id, count);
    if (entity.type === "protein") {
      const templates = templatesByEntity.get(entity.id) ?? [];
      if (templates.length > 1) errors.push(`Protenix accepts one template-search file per protein; ${entity.id} has ${templates.length}.`);
      const template = templates[0];
      if (template && template.format !== "hhr" && template.format !== "a3m") {
        errors.push(`Template ${template.id} uses ${template.format}; Protenix accepts local HHR or A3M template-search output.`);
      }
      if (mini && template) errors.push("Protenix Mini Default v0.5.0 does not support templates.");
      const value: Record<string, unknown> = {
        sequence: normalizedSequence(entity.sequence),
        count,
        id: ids,
      };
      if (entity.msa) {
        value.unpairedMsaPath = entity.msa.path;
        useMsa = true;
      }
      if (template && !mini && (template.format === "hhr" || template.format === "a3m")) {
        value.templatesPath = template.path;
        useTemplate = true;
      }
      sequences.push({ proteinChain: value });
      continue;
    }
    if (templatesByEntity.has(entity.id)) errors.push(`Protenix template must reference a protein, not ${entity.id}.`);
    if (entity.type === "dna") {
      sequences.push({ dnaSequence: { sequence: normalizedSequence(entity.sequence), count, id: ids } });
    } else if (entity.type === "rna") {
      sequences.push({ rnaSequence: { sequence: normalizedSequence(entity.sequence), count, id: ids } });
    } else if (entity.type === "ligand") {
      sequences.push({ ligand: {
        ligand: entity.smiles ?? `CCD_${entity.ccdCode ?? ""}`,
        count,
        id: ids,
      } });
    } else {
      errors.push(`Unsupported complex entity type: ${String(entity.type)}.`);
    }
  }

  const covalentBonds: Array<Record<string, string | number>> = [];
  for (const [index, constraint] of (request.spec.constraints ?? []).entries()) {
    if (constraint.type !== "bond") {
      errors.push(`Constraint ${index + 1} is not supported by ${mini ? "Protenix Mini Default v0.5.0" : "Protenix v2"}.`);
      continue;
    }
    const left = protenixConstraintSide(request.spec, constraint.left, 1, errors);
    const right = protenixConstraintSide(request.spec, constraint.right, 2, errors);
    if (left && right) covalentBonds.push({ ...left, ...right });
  }

  if (!validation.valid || errors.length > 0) return adapterFailure(validation, errors);
  const name = request.spec.name?.trim() || "liatir_prediction";
  return {
    valid: true,
    errors: [],
    warnings: validation.warnings,
    input: {
      document: [{ name, sequences, ...(covalentBonds.length ? { covalent_bonds: covalentBonds } : {}) }],
      useMsa,
      useTemplate,
    },
  };
}

export const BOLTZ_AFFINITY_RECOMMENDED_LIGAND_ATOMS = 56 as const;
export const BOLTZ_AFFINITY_MAX_LIGAND_ATOMS = 128 as const;

export interface LiatirProteinLigandAffinityRequest extends LiatirStructurePredictionRequest {
  modelId: typeof BOLTZ_2_MODEL_ID;
  ligandAtomCount: number;
}

/**
 * The affinity complex shape, checked without a chemistry toolkit.
 *
 * Split out because the editor can apply it while the user is still typing, whereas the atom-count
 * rules below need the ligand parsed inside the installed Runtime Box. Keeping one implementation
 * means the screen and the runner can never disagree about what an affinity input is.
 */
export function validateProteinLigandAffinityComplex(spec: LiatirComplexSpec): string[] {
  const errors: string[] = [];
  const proteins = spec.entities.filter(
    (entity): entity is LiatirComplexPolymerEntity => entity.type === "protein",
  );
  const ligands = spec.entities.filter((entity) => entity.type === "ligand");

  if (spec.entities.length !== 2 || proteins.length !== 1 || ligands.length !== 1) {
    errors.push("Affinity prediction requires exactly one protein and one small ligand.");
  }
  if (proteins.some((entity) => (entity.copies ?? 1) !== 1) || ligands.some((entity) => (entity.copies ?? 1) !== 1)) {
    errors.push("Affinity prediction requires one copy of the protein and one copy of the ligand.");
  }
  return errors;
}

/** Apply Boltz-2's declared affinity scope before loading the model. */
export function validateProteinLigandAffinityRequest(
  request: LiatirProteinLigandAffinityRequest,
): LiatirValidationResult {
  const structure = validateStructurePredictionRequest(request);
  const errors = [...structure.errors, ...validateProteinLigandAffinityComplex(request.spec)];
  const warnings = [...structure.warnings];

  if (!Number.isSafeInteger(request.ligandAtomCount) || request.ligandAtomCount < 1) {
    errors.push("Ligand atom count must be a positive integer computed by the chemistry preflight.");
  } else if (request.ligandAtomCount > BOLTZ_AFFINITY_MAX_LIGAND_ATOMS) {
    errors.push(`Boltz-2 affinity prediction does not accept ligands above ${BOLTZ_AFFINITY_MAX_LIGAND_ATOMS} atoms.`);
  } else if (request.ligandAtomCount > BOLTZ_AFFINITY_RECOMMENDED_LIGAND_ATOMS) {
    warnings.push(`This ligand has more than ${BOLTZ_AFFINITY_RECOMMENDED_LIGAND_ATOMS} atoms and is outside Boltz-2's recommended training range.`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

export interface LiatirProteinLigandAffinityValues {
  /** Probability that the supplied ligand binds the supplied protein, from 0 through 1. */
  bindingProbability: number;
  /** Boltz-2 affinity value: log10(IC50), with IC50 measured in micromolar. Lower means stronger predicted affinity. */
  log10MicromolarIc50: number;
}

export function validateProteinLigandAffinityValues(
  values: LiatirProteinLigandAffinityValues,
): LiatirValidationResult {
  const errors: string[] = [];
  if (!Number.isFinite(values.bindingProbability) || values.bindingProbability < 0 || values.bindingProbability > 1) {
    errors.push("Binding probability must be finite and between 0 and 1.");
  }
  if (!Number.isFinite(values.log10MicromolarIc50)) {
    errors.push("log10(IC50) must be finite.");
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

/** Metrics are produced by a lightweight input preflight, before importing the scientific runtime. */
export interface LiatirHardwareWorkloadMetrics {
  /** Only measurements for this scientific operation and preparation mode may be reused. */
  workloadId: string;
  tokenCount: number;
  atomCount: number;
  /** Integration/minimization or inference steps, independent of saved output count. */
  stepCount: number;
  /** Structure models for prediction, or saved trajectory frames for molecular dynamics. */
  outputItemCount: number;
}

export interface LiatirHardwareMeasurementSample {
  fixtureId: string;
  workloadId: string;
  maxTokenCount: number;
  maxAtomCount: number;
  maxStepCount: number;
  maxOutputItemCount: number;
  peakRamBytes: number;
  peakVramBytes: number | null;
  elapsedMs: number;
  outputBytes: number;
}

/** A measured target envelope. Guesses and vendor marketing figures are not valid samples. */
export interface LiatirHardwareValidationProfile {
  schemaVersion: 1;
  profileId: string;
  componentId: string;
  componentVersion: string;
  runtimeBoxRelease: string;
  target: LiatirRuntimeBoxTarget;
  precision: string;
  measuredAt: string;
  evidenceRecord: string;
  samples: LiatirHardwareMeasurementSample[];
}

/**
 * Every sample below is transcribed from the retained evidence record named by `evidenceRecord`,
 * and `tests/unit/phase3-hardware-profiles.test.ts` fails if any value drifts from that file. A
 * measurement produced by a development-signed build stays valid only for that release identity;
 * a production build of the same release must be re-measured before this profile is reused for it.
 */
const OPENMM_MACOS_AARCH64_CPU_DEVELOPMENT_PROFILE: LiatirHardwareValidationProfile = {
  schemaVersion: 1,
  profileId: "openmm-8.5.1-beta.1-macos-aarch64-cpu-development-2026-09-09",
  componentId: OPENMM_RUNTIME_COMPONENT_ID,
  componentVersion: OPENMM_VERSION,
  runtimeBoxRelease: "8.5.1-beta.1",
  target: { platform: "macos", arch: "aarch64", accelerator: "cpu" },
  precision: "mixed",
  measuredAt: "2026-09-09T11:45:33.469Z",
  evidenceRecord: "runtime-boxes/measurements/openmm-macos-aarch64-cpu-development-2026-09-09.json",
  samples: [
    {
      fixtureId: "official-protein-relaxation",
      workloadId: "openmm:relaxation:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 33,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 83886080,
      peakVramBytes: null,
      elapsedMs: 514,
      outputBytes: 13738,
    },
    {
      fixtureId: "add-missing-hydrogens",
      workloadId: "openmm:relaxation:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 33,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 85508096,
      peakVramBytes: null,
      elapsedMs: 651,
      outputBytes: 13735,
    },
    {
      fixtureId: "protein-ligand-relaxation",
      workloadId: "openmm:relaxation:none:openff",
      maxTokenCount: 1,
      maxAtomCount: 42,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 592035840,
      peakVramBytes: null,
      elapsedMs: 13309,
      outputBytes: 18490,
    },
    {
      fixtureId: "protein-dynamics-10ps",
      workloadId: "openmm:dynamics:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 33,
      maxStepCount: 5000,
      maxOutputItemCount: 10,
      peakRamBytes: 85655552,
      peakVramBytes: null,
      elapsedMs: 3664,
      outputBytes: 461059,
    },
    {
      fixtureId: "protein-checkpoint-resume",
      workloadId: "openmm:dynamics:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 33,
      maxStepCount: 5000,
      maxOutputItemCount: 10,
      peakRamBytes: 66961408,
      peakVramBytes: null,
      elapsedMs: 3313,
      outputBytes: 461910,
    },
    {
      fixtureId: "protein-dynamics-100ps",
      workloadId: "openmm:dynamics:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 33,
      maxStepCount: 50000,
      maxOutputItemCount: 10,
      peakRamBytes: 91127808,
      peakVramBytes: null,
      elapsedMs: 32233,
      outputBytes: 461067,
    },
    {
      fixtureId: "multi-residue-relaxation",
      workloadId: "openmm:relaxation:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 407,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 89915392,
      peakVramBytes: null,
      elapsedMs: 575,
      outputBytes: 144599,
    },
    {
      fixtureId: "dhfr-protein-relaxation",
      workloadId: "openmm:relaxation:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 2489,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 115703808,
      peakVramBytes: null,
      elapsedMs: 10676,
      outputBytes: 831592,
    },
    {
      fixtureId: "dhfr-drug-ligand-relaxation",
      workloadId: "openmm:relaxation:none:openff",
      maxTokenCount: 1,
      maxAtomCount: 2530,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 604307456,
      peakVramBytes: null,
      elapsedMs: 27413,
      outputBytes: 851471,
    },
    {
      fixtureId: "dhfr-solvated-relaxation",
      workloadId: "openmm:relaxation:tip3p-fb:standard",
      maxTokenCount: 1,
      maxAtomCount: 29419,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 359858176,
      peakVramBytes: null,
      elapsedMs: 130050,
      outputBytes: 9907557,
    },
    {
      fixtureId: "dhfr-solvated-dynamics-10ps",
      workloadId: "openmm:dynamics:tip3p-fb:standard",
      maxTokenCount: 1,
      maxAtomCount: 29419,
      maxStepCount: 5000,
      maxOutputItemCount: 10,
      peakRamBytes: 365821952,
      peakVramBytes: null,
      elapsedMs: 218756,
      outputBytes: 31317244,
    },
    {
      fixtureId: "solvated-dynamics-custom",
      workloadId: "openmm:dynamics:tip3p-fb:standard",
      maxTokenCount: 1,
      maxAtomCount: 974,
      maxStepCount: 10,
      maxOutputItemCount: 2,
      peakRamBytes: 90832896,
      peakVramBytes: null,
      elapsedMs: 4891,
      outputBytes: 1267552,
    },
    {
      fixtureId: "solvated-checkpoint-resume",
      workloadId: "openmm:dynamics:tip3p-fb:standard",
      maxTokenCount: 1,
      maxAtomCount: 974,
      maxStepCount: 10,
      maxOutputItemCount: 2,
      peakRamBytes: 72007680,
      peakVramBytes: null,
      elapsedMs: 213,
      outputBytes: 1268419,
    },
  ],
};

/**
 * The first GPU envelope in this project. Its `peakVramBytes` figures are device-wide deltas,
 * not per-process readings: WSL2's driver reports no per-process GPU memory at all, so a run is
 * charged for everything the card gained while it ran. They can only over-state, never
 * under-state. The evidence record names the method per case; see the VRAM measurement decision.
 */
const OPENMM_LINUX_X86_64_CUDA129_DEVELOPMENT_PROFILE: LiatirHardwareValidationProfile = {
  schemaVersion: 1,
  profileId: "openmm-8.5.1-beta.1-linux-x86_64-cuda12.9-development-2026-09-09",
  componentId: OPENMM_RUNTIME_COMPONENT_ID,
  componentVersion: OPENMM_VERSION,
  runtimeBoxRelease: "8.5.1-beta.1",
  target: { platform: "linux", arch: "x86_64", accelerator: "cuda", cudaVersion: "12.9" },
  precision: "mixed",
  measuredAt: "2026-09-09T13:46:54.588Z",
  evidenceRecord:
    "runtime-boxes/measurements/openmm-linux-x86_64-cuda12.9-development-2026-09-09.json",
  samples: [
    {
      fixtureId: "official-protein-relaxation",
      workloadId: "openmm:relaxation:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 33,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 281591808,
      peakVramBytes: 127926272,
      elapsedMs: 1822,
      outputBytes: 13787,
    },
    {
      fixtureId: "add-missing-hydrogens",
      workloadId: "openmm:relaxation:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 33,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 251789312,
      peakVramBytes: 100663296,
      elapsedMs: 909,
      outputBytes: 13785,
    },
    {
      fixtureId: "protein-ligand-relaxation",
      workloadId: "openmm:relaxation:none:openff",
      maxTokenCount: 1,
      maxAtomCount: 42,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 872071168,
      peakVramBytes: 121634816,
      elapsedMs: 7507,
      outputBytes: 18538,
    },
    {
      fixtureId: "protein-dynamics-10ps",
      workloadId: "openmm:dynamics:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 33,
      maxStepCount: 5000,
      maxOutputItemCount: 10,
      peakRamBytes: 307953664,
      peakVramBytes: 126877696,
      elapsedMs: 1900,
      outputBytes: 657885,
    },
    {
      fixtureId: "protein-checkpoint-resume",
      workloadId: "openmm:dynamics:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 33,
      maxStepCount: 5000,
      maxOutputItemCount: 10,
      peakRamBytes: 232337408,
      peakVramBytes: 126877696,
      elapsedMs: 1240,
      outputBytes: 658744,
    },
    {
      fixtureId: "protein-dynamics-100ps",
      workloadId: "openmm:dynamics:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 33,
      maxStepCount: 50000,
      maxOutputItemCount: 10,
      peakRamBytes: 254709760,
      peakVramBytes: 132120576,
      elapsedMs: 5715,
      outputBytes: 657900,
    },
    {
      fixtureId: "multi-residue-relaxation",
      workloadId: "openmm:relaxation:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 407,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 319774720,
      peakVramBytes: 126877696,
      elapsedMs: 2009,
      outputBytes: 144647,
    },
    {
      fixtureId: "dhfr-protein-relaxation",
      workloadId: "openmm:relaxation:none:standard",
      maxTokenCount: 1,
      maxAtomCount: 2489,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 327270400,
      peakVramBytes: 128974848,
      elapsedMs: 4060,
      outputBytes: 831639,
    },
    {
      fixtureId: "dhfr-drug-ligand-relaxation",
      workloadId: "openmm:relaxation:none:openff",
      maxTokenCount: 1,
      maxAtomCount: 2530,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 898355200,
      peakVramBytes: 128974848,
      elapsedMs: 9764,
      outputBytes: 851517,
    },
    {
      fixtureId: "dhfr-solvated-relaxation",
      workloadId: "openmm:relaxation:tip3p-fb:standard",
      maxTokenCount: 1,
      maxAtomCount: 29419,
      maxStepCount: 5000,
      maxOutputItemCount: 1,
      peakRamBytes: 478240768,
      peakVramBytes: 177209344,
      elapsedMs: 14089,
      outputBytes: 9907605,
    },
    {
      fixtureId: "dhfr-solvated-dynamics-10ps",
      workloadId: "openmm:dynamics:tip3p-fb:standard",
      maxTokenCount: 1,
      maxAtomCount: 29419,
      maxStepCount: 5000,
      maxOutputItemCount: 10,
      peakRamBytes: 484532224,
      peakVramBytes: 193986560,
      elapsedMs: 13663,
      outputBytes: 34451141,
    },
    {
      fixtureId: "solvated-dynamics-custom",
      workloadId: "openmm:dynamics:tip3p-fb:standard",
      maxTokenCount: 1,
      maxAtomCount: 974,
      maxStepCount: 10,
      maxOutputItemCount: 2,
      peakRamBytes: 402657280,
      peakVramBytes: 140509184,
      elapsedMs: 4725,
      outputBytes: 1556502,
    },
    {
      fixtureId: "solvated-checkpoint-resume",
      workloadId: "openmm:dynamics:tip3p-fb:standard",
      maxTokenCount: 1,
      maxAtomCount: 974,
      maxStepCount: 10,
      maxOutputItemCount: 2,
      peakRamBytes: 338706432,
      peakVramBytes: 119537664,
      elapsedMs: 741,
      outputBytes: 1557391,
    },
  ],
};

/**
 * Retained Phase 3 measurements that the product may use as run envelopes.
 *
 * A profile is added only after its exact target validator has produced reviewable evidence, so an
 * unmeasured component, release or target still fails closed instead of inventing a memory or
 * runtime estimate. Boltz-2, Protenix v2 and Protenix Mini Default have no measurement yet.
 */
export const LIATIR_PHASE3_HARDWARE_VALIDATION_PROFILES:
  readonly LiatirHardwareValidationProfile[] = [
    OPENMM_MACOS_AARCH64_CPU_DEVELOPMENT_PROFILE,
    OPENMM_LINUX_X86_64_CUDA129_DEVELOPMENT_PROFILE,
  ];

export function phase3HardwareValidationProfile(input: {
  componentId: string;
  componentVersion: string;
  runtimeBoxRelease: string;
  target: LiatirRuntimeBoxTarget;
}): LiatirHardwareValidationProfile | null {
  const targetId = runtimeBoxTargetId(input.target);
  return LIATIR_PHASE3_HARDWARE_VALIDATION_PROFILES.find((profile) => (
    profile.componentId === input.componentId
    && profile.componentVersion === input.componentVersion
    && profile.runtimeBoxRelease === input.runtimeBoxRelease
    && runtimeBoxTargetId(profile.target) === targetId
  )) ?? null;
}

/** Whether a run's resource figures come from a retained measurement or from beyond one. */
export type LiatirHardwareEvidence = "measured" | "beyond-evidence";

/** What the host can offer. `null` means the native probe reported nothing, not zero. */
export interface LiatirHardwareHostMemory {
  totalMemoryBytes: number | null;
}

export interface LiatirHardwareResourceEstimate extends LiatirHardwareWorkloadMetrics {
  accepted: true;
  evidence: "measured";
  /** Inside the envelope nothing is guessed, so the run needs no extra acknowledgement. */
  confirmationRequired: false;
  hardwareProfileId: string;
  sampleFixtureId: string;
  estimatedRamBytes: number;
  estimatedVramBytes: number | null;
  estimatedTimeMs: number;
  estimatedOutputBytes: number;
  evidenceRecord: string;
}

/**
 * A run larger than anything measured. Deliberately carries no invented estimate: the figures are
 * the largest measured point this request is already known to exceed, so they are a floor and are
 * named as one. A user with a big machine may still run it after acknowledging that.
 */
export interface LiatirHardwareResourceExtrapolation extends LiatirHardwareWorkloadMetrics {
  accepted: true;
  evidence: "beyond-evidence";
  confirmationRequired: true;
  hardwareProfileId: string;
  evidenceRecord: string;
  /** The dominated sample the floor comes from, or `null` when no measured point is smaller. */
  floorFixtureId: string | null;
  minimumRamBytes: number | null;
  maxValidatedTokenCount: number;
  maxValidatedAtomCount: number;
  maxValidatedStepCount: number;
  maxValidatedOutputItemCount: number;
}

export interface LiatirHardwareResourceRejection {
  accepted: false;
  /** `impossible` is the only refusal about size; the rest mean there is nothing to judge with. */
  reason: "impossible" | "no-evidence" | "invalid-metrics";
  error: string;
  maxValidatedTokenCount: number;
  maxValidatedAtomCount: number;
  maxValidatedStepCount: number;
  maxValidatedOutputItemCount: number;
}

export type LiatirHardwareResourcePreflight =
  | LiatirHardwareResourceEstimate
  | LiatirHardwareResourceExtrapolation
  | LiatirHardwareResourceRejection;

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validMeasurementSample(sample: LiatirHardwareMeasurementSample): boolean {
  return typeof sample.workloadId === "string" && sample.workloadId.trim().length > 0
    && positiveSafeInteger(sample.maxTokenCount)
    && positiveSafeInteger(sample.maxAtomCount)
    && positiveSafeInteger(sample.maxStepCount)
    && positiveSafeInteger(sample.maxOutputItemCount)
    && positiveSafeInteger(sample.peakRamBytes)
    && (sample.peakVramBytes === null || positiveSafeInteger(sample.peakVramBytes))
    && positiveSafeInteger(sample.elapsedMs)
    && positiveSafeInteger(sample.outputBytes);
}

/**
 * Judge one request against the retained measurements for its target.
 *
 * Inside the measured envelope the smallest dominating sample supplies real figures. Outside it,
 * the run is still allowed after an explicit acknowledgement, because the measured ceiling is the
 * size of whichever fixture happened to be validated, never a property of this machine — blocking
 * on it refused every realistic protein while the runtime could compute them.
 *
 * The one refusal about size is a certain failure: the largest measured point the request already
 * exceeds is a floor on what it will need, so a floor above the host's installed memory cannot
 * succeed. With no host figure and no smaller measured point nothing is certain, so nothing is
 * refused. No estimate is ever extrapolated past the evidence and presented as if measured.
 */
export function estimateHardwareResources(
  metrics: LiatirHardwareWorkloadMetrics,
  profile: LiatirHardwareValidationProfile,
  host: LiatirHardwareHostMemory = { totalMemoryBytes: null },
): LiatirHardwareResourcePreflight {
  const samples = profile.samples.filter((sample) => validMeasurementSample(sample)
    && sample.workloadId === metrics.workloadId);
  const maxima = {
    tokens: Math.max(0, ...samples.map((sample) => sample.maxTokenCount)),
    atoms: Math.max(0, ...samples.map((sample) => sample.maxAtomCount)),
    steps: Math.max(0, ...samples.map((sample) => sample.maxStepCount)),
    outputs: Math.max(0, ...samples.map((sample) => sample.maxOutputItemCount)),
  };
  const invalidMetrics = !positiveSafeInteger(metrics.tokenCount)
    || !positiveSafeInteger(metrics.atomCount)
    || !positiveSafeInteger(metrics.stepCount)
    || !positiveSafeInteger(metrics.outputItemCount);
  const validated = {
    maxValidatedTokenCount: maxima.tokens,
    maxValidatedAtomCount: maxima.atoms,
    maxValidatedStepCount: maxima.steps,
    maxValidatedOutputItemCount: maxima.outputs,
  };
  if (samples.length === 0 || invalidMetrics) {
    return {
      accepted: false,
      reason: samples.length === 0 ? "no-evidence" : "invalid-metrics",
      error: samples.length === 0
        ? "No valid measured hardware envelope is available for this target."
        : "Workload metrics must be positive integers produced by the input preflight.",
      ...validated,
    };
  }

  const candidates = samples
    .filter((sample) => metrics.tokenCount <= sample.maxTokenCount
      && metrics.atomCount <= sample.maxAtomCount
      && metrics.stepCount <= sample.maxStepCount
      && metrics.outputItemCount <= sample.maxOutputItemCount)
    .sort((left, right) => {
      const leftVolume = left.maxTokenCount * left.maxAtomCount * left.maxOutputItemCount * left.maxStepCount;
      const rightVolume = right.maxTokenCount * right.maxAtomCount * right.maxOutputItemCount * right.maxStepCount;
      return leftVolume - rightVolume;
    });
  const sample = candidates[0];
  const requested = {
    workloadId: metrics.workloadId,
    tokenCount: metrics.tokenCount,
    atomCount: metrics.atomCount,
    stepCount: metrics.stepCount,
    outputItemCount: metrics.outputItemCount,
  };
  if (sample) {
    return {
      accepted: true,
      evidence: "measured",
      confirmationRequired: false,
      hardwareProfileId: profile.profileId,
      sampleFixtureId: sample.fixtureId,
      ...requested,
      estimatedRamBytes: sample.peakRamBytes,
      estimatedVramBytes: sample.peakVramBytes,
      estimatedTimeMs: sample.elapsedMs,
      estimatedOutputBytes: sample.outputBytes,
      evidenceRecord: profile.evidenceRecord,
    };
  }

  // The heaviest measured point this request already exceeds in every dimension. It cannot need
  // less than that, which is the only thing about a larger run that is known rather than guessed.
  const floor = samples
    .filter((candidate) => metrics.tokenCount >= candidate.maxTokenCount
      && metrics.atomCount >= candidate.maxAtomCount
      && metrics.stepCount >= candidate.maxStepCount
      && metrics.outputItemCount >= candidate.maxOutputItemCount)
    .reduce<LiatirHardwareMeasurementSample | null>(
      (heaviest, candidate) => (!heaviest || candidate.peakRamBytes > heaviest.peakRamBytes
        ? candidate
        : heaviest),
      null,
    );
  if (floor && host.totalMemoryBytes !== null && floor.peakRamBytes > host.totalMemoryBytes) {
    return {
      accepted: false,
      reason: "impossible",
      error: "This run needs more memory than this computer has installed, so it cannot finish.",
      ...validated,
    };
  }

  return {
    accepted: true,
    evidence: "beyond-evidence",
    confirmationRequired: true,
    hardwareProfileId: profile.profileId,
    evidenceRecord: profile.evidenceRecord,
    floorFixtureId: floor?.fixtureId ?? null,
    minimumRamBytes: floor?.peakRamBytes ?? null,
    ...requested,
    ...validated,
  };
}

export interface LiatirPublishedVramRequirements {
  measuredPeakVramBytes: number;
  minimumVramBytes: number;
  recommendedVramBytes: number;
}

/** Derive published VRAM requirements only from the largest retained measurement. */
export function publishedVramRequirements(
  profile: LiatirHardwareValidationProfile,
): LiatirPublishedVramRequirements | null {
  const peaks = profile.samples
    .filter(validMeasurementSample)
    .map((sample) => sample.peakVramBytes)
    .filter((value): value is number => value !== null);
  if (peaks.length === 0) return null;
  const measuredPeakVramBytes = Math.max(...peaks);
  return {
    measuredPeakVramBytes,
    minimumVramBytes: Math.ceil(measuredPeakVramBytes * 1.25),
    recommendedVramBytes: Math.ceil(measuredPeakVramBytes * 1.5),
  };
}

export type LiatirPhase3MsaProvenance =
  | { mode: "local-a3m"; localA3mEntityIds: string[]; singleSequenceEntityIds: [] }
  | { mode: "single-sequence"; localA3mEntityIds: []; singleSequenceEntityIds: string[] }
  | { mode: "mixed"; localA3mEntityIds: string[]; singleSequenceEntityIds: string[] }
  | { mode: "not-applicable"; localA3mEntityIds: []; singleSequenceEntityIds: [] };

/** Required provenance shared by every Phase 3 Result. Non-applicable facts are explicit. */
export interface LiatirPhase3ResultProvenance {
  schemaVersion: 1;
  componentId: string;
  model: { id: string; version: string } | null;
  forceField: { protein: string; water: string | null; ligand: string | null } | null;
  accelerator: LiatirRuntimeBoxTarget["accelerator"];
  computeDevice: string;
  precision: string;
  seed: number;
  msa: LiatirPhase3MsaProvenance;
  scrollcase: {
    boxId: string;
    runtimeId: string;
    releaseVersion: string;
    target: LiatirRuntimeBoxTarget;
    archiveSha256: string;
  };
  hardwareProfileId: string;
  /** A Result must say whether its run stayed inside the retained measurements or went past them. */
  hardwareEvidence: LiatirHardwareEvidence;
}

export interface LiatirStructureModelRow {
  rank: number;
  mmcifPath: string;
  confidence: number;
  ptm?: number;
  iptm?: number;
  meanPaeAngstrom?: number;
  meanPdeAngstrom?: number;
}

export interface LiatirStructurePredictionOutputs {
  primaryMmcifPath: string;
  confidenceJsonPath: string;
  paePath?: string;
  pdePath?: string;
  modelTableCsvPath: string;
  models: LiatirStructureModelRow[];
}

export function validateStructureModelRows(rows: LiatirStructureModelRow[]): LiatirValidationResult {
  const errors: string[] = [];
  if (rows.length === 0) errors.push("At least one predicted structure is required.");
  for (const [index, row] of rows.entries()) {
    const label = `Model row ${index + 1}`;
    if (!positiveSafeInteger(row.rank)) errors.push(`${label} rank must be a positive integer.`);
    if (!row.mmcifPath.trim()) errors.push(`${label} must reference an mmCIF file.`);
    for (const [name, value] of [["confidence", row.confidence], ["pTM", row.ptm], ["ipTM", row.iptm]] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
        errors.push(`${label} ${name} must be finite and between 0 and 1.`);
      }
    }
    for (const [name, value] of [["mean PAE", row.meanPaeAngstrom], ["mean PDE", row.meanPdeAngstrom]] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        errors.push(`${label} ${name} must be a finite non-negative distance.`);
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

export const OPENMM_PROTEIN_FORCE_FIELD = "amber19-all" as const;
export const OPENMM_WATER_FORCE_FIELD = "tip3p-fb" as const;
export const OPENMM_OPENFF_FORCE_FIELD = "openff-2.3.0" as const;
export const OPENMM_NAGL_CHARGE_MODEL = "openff-gnn-am1bcc-1.0.0.pt" as const;
export const OPENMM_NAGL_CHARGE_MODEL_SHA256 = "7981e7f5b0b1e424c9e10a40d9e7606d96dcd3dd2b095cb4eeff6829f92238ee" as const;
export const OPENMM_LIGAND_PARAMETERIZATION = "openff-2.3.0+nagl-am1bcc-1.0.0" as const;
export const OPENMM_FORCE_FIELD_ID = "amber19-all+tip3p-fb+openff-2.3.0+nagl-am1bcc-1.0.0" as const;
export const OPENMM_TIMESTEP_FEMTOSECONDS = 2 as const;
export const OPENMM_INTERPRETATION_NOTICE =
  "OpenMM simulates atomic motion with a force field. It does not prove binding affinity, molecular stability, clinical benefit, or therapeutic efficacy." as const;

export interface LiatirOpenMMPreparationOptions {
  addHydrogens: boolean;
  ph: number;
  solvent: "none" | typeof OPENMM_WATER_FORCE_FIELD;
  solventPaddingNm?: number;
  ionicStrengthM?: number;
}

/** OpenMM accepts a signed 32-bit seed; zero requests an automatically selected seed. */
export const OPENMM_MAX_SEED = 2_147_483_647;

function validOpenMMSeed(seed: number): boolean {
  return Number.isSafeInteger(seed) && seed >= 1 && seed <= OPENMM_MAX_SEED;
}

export interface LiatirMolecularRelaxationOptions {
  preparation: LiatirOpenMMPreparationOptions;
  maxIterations: number;
  toleranceKilojoulePerMoleNanometer: number;
  seed: number;
}

export type LiatirMolecularDynamicsDurationPreset = "verification-10ps" | "short-100ps" | "custom";

export interface LiatirMolecularDynamicsOptions {
  preset: LiatirMolecularDynamicsDurationPreset;
  customDurationPs?: number;
  temperatureKelvin: number;
  pressureBar?: number;
  saveIntervalPs: number;
  seed: number;
}

export interface LiatirMolecularDynamicsRunOptions extends LiatirMolecularDynamicsOptions {
  preparation: LiatirOpenMMPreparationOptions;
}

export function molecularDynamicsDurationPs(options: LiatirMolecularDynamicsOptions): number | null {
  if (options.preset === "verification-10ps") return 10;
  if (options.preset === "short-100ps") return 100;
  return options.customDurationPs ?? null;
}

export function validateOpenMMPreparationOptions(
  options: LiatirOpenMMPreparationOptions,
): LiatirValidationResult {
  const errors: string[] = [];
  if (typeof options.addHydrogens !== "boolean") errors.push("Add hydrogens must be a boolean.");
  if (!Number.isFinite(options.ph) || options.ph < 0 || options.ph > 14) {
    errors.push("Preparation pH must be between 0 and 14.");
  }
  if (options.solvent === "none") {
    if (options.solventPaddingNm !== undefined || options.ionicStrengthM !== undefined) {
      errors.push("Solvent padding and ionic strength require explicit TIP3P-FB solvent.");
    }
  } else if (options.solvent === OPENMM_WATER_FORCE_FIELD) {
    if (!Number.isFinite(options.solventPaddingNm) || !(options.solventPaddingNm! > 0)) {
      errors.push("Solvated preparation requires positive padding in nanometers.");
    }
    if (!Number.isFinite(options.ionicStrengthM) || options.ionicStrengthM! < 0 || options.ionicStrengthM! > 1) {
      errors.push("Ionic strength must be between 0 and 1 molar.");
    }
  } else {
    errors.push("Solvent must be none or TIP3P-FB.");
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validateMolecularRelaxationOptions(
  options: LiatirMolecularRelaxationOptions,
): LiatirValidationResult {
  const preparation = validateOpenMMPreparationOptions(options.preparation);
  const errors = [...preparation.errors];
  if (!Number.isSafeInteger(options.maxIterations) || options.maxIterations < 1 || options.maxIterations > 10_000_000) {
    errors.push("Minimization iterations must be an integer from 1 through 10000000.");
  }
  if (!Number.isFinite(options.toleranceKilojoulePerMoleNanometer)
    || options.toleranceKilojoulePerMoleNanometer <= 0) {
    errors.push("Minimization tolerance must be positive.");
  }
  if (!validOpenMMSeed(options.seed)) errors.push(`OpenMM seed must be an integer from 1 through ${OPENMM_MAX_SEED}.`);
  return { valid: errors.length === 0, errors, warnings: preparation.warnings };
}

export function validateMolecularDynamicsOptions(
  options: LiatirMolecularDynamicsOptions,
): LiatirValidationResult {
  const errors: string[] = [];
  const durationPs = molecularDynamicsDurationPs(options);
  if (!["verification-10ps", "short-100ps", "custom"].includes(options.preset)) {
    errors.push("Molecular dynamics preset is not supported.");
  }
  if (options.preset === "custom" && (!Number.isFinite(options.customDurationPs) || !(options.customDurationPs! > 0))) {
    errors.push("Custom molecular dynamics duration must be positive.");
  }
  if (options.preset !== "custom" && options.customDurationPs !== undefined) {
    errors.push("Custom duration is allowed only with the custom preset.");
  }
  if (!Number.isFinite(options.temperatureKelvin) || options.temperatureKelvin <= 0) {
    errors.push("Temperature must be positive Kelvin.");
  }
  if (options.pressureBar !== undefined && (!Number.isFinite(options.pressureBar) || options.pressureBar <= 0)) {
    errors.push("Pressure must be positive when supplied.");
  }
  if (!Number.isFinite(options.saveIntervalPs) || options.saveIntervalPs <= 0) {
    errors.push("Save interval must be positive.");
  } else if (durationPs !== null && options.saveIntervalPs > durationPs) {
    errors.push("Save interval cannot exceed the simulation duration.");
  }
  if (!validOpenMMSeed(options.seed)) errors.push(`OpenMM seed must be an integer from 1 through ${OPENMM_MAX_SEED}.`);
  return { valid: errors.length === 0, errors, warnings: [] };
}

export function validateMolecularDynamicsRunOptions(
  options: LiatirMolecularDynamicsRunOptions,
): LiatirValidationResult {
  const preparation = validateOpenMMPreparationOptions(options.preparation);
  const dynamics = validateMolecularDynamicsOptions(options);
  const errors = [...preparation.errors, ...dynamics.errors];
  if (options.pressureBar !== undefined && options.preparation.solvent === "none") {
    errors.push("Constant pressure requires an explicitly solvated periodic system.");
  }
  const durationPs = molecularDynamicsDurationPs(options);
  if (durationPs !== null) {
    const durationSteps = durationPs * 1_000 / OPENMM_TIMESTEP_FEMTOSECONDS;
    const reportSteps = options.saveIntervalPs * 1_000 / OPENMM_TIMESTEP_FEMTOSECONDS;
    if (!Number.isSafeInteger(durationSteps)) {
      errors.push(`Duration must align to the fixed ${OPENMM_TIMESTEP_FEMTOSECONDS} fs timestep.`);
    }
    if (!Number.isSafeInteger(reportSteps)) {
      errors.push(`Save interval must align to the fixed ${OPENMM_TIMESTEP_FEMTOSECONDS} fs timestep.`);
    }
  }
  return { valid: errors.length === 0, errors, warnings: [...preparation.warnings, ...dynamics.warnings] };
}

export interface LiatirOpenMMCheckpointIdentity {
  schemaVersion: 1;
  kind: "liatir.openmm-checkpoint";
  runtimeId: typeof OPENMM_RUNTIME_ID;
  runtimeBoxRelease: string;
  targetId: string;
  topologySha256: string;
  systemSha256: string;
  integratorSha256: string;
  configurationSha256: string;
  forceFieldId: string;
}

/** Checkpoint bytes are usable only by the exact runtime release, target, topology and force field. */
export function validateOpenMMCheckpointResume(
  checkpoint: LiatirOpenMMCheckpointIdentity,
  expected: LiatirOpenMMCheckpointIdentity,
): LiatirValidationResult {
  const errors: string[] = [];
  if (checkpoint.schemaVersion !== 1 || checkpoint.kind !== "liatir.openmm-checkpoint") {
    errors.push("Checkpoint metadata is not a supported Liatir OpenMM checkpoint.");
  }
  if (checkpoint.runtimeBoxRelease !== expected.runtimeBoxRelease) {
    errors.push(`Checkpoint runtime version ${checkpoint.runtimeBoxRelease} does not match installed version ${expected.runtimeBoxRelease}.`);
  }
  if (checkpoint.targetId !== expected.targetId) {
    errors.push(`Checkpoint target ${checkpoint.targetId} does not match selected target ${expected.targetId}.`);
  }
  if (checkpoint.runtimeId !== expected.runtimeId) errors.push("Checkpoint belongs to a different OpenMM runtime.");
  if (checkpoint.topologySha256 !== expected.topologySha256) errors.push("Checkpoint topology does not match the selected system.");
  if (checkpoint.systemSha256 !== expected.systemSha256) errors.push("Checkpoint OpenMM System does not match the selected system.");
  if (checkpoint.integratorSha256 !== expected.integratorSha256) errors.push("Checkpoint integrator does not match the selected system.");
  if (checkpoint.configurationSha256 !== expected.configurationSha256) errors.push("Checkpoint inputs or simulation settings do not match.");
  if (checkpoint.forceFieldId !== expected.forceFieldId) errors.push("Checkpoint force field does not match the selected system.");
  return { valid: errors.length === 0, errors, warnings: [] };
}

export interface LiatirMolecularRelaxationOutputs {
  preparedStructurePath: string;
  finalStructurePath: string;
  topologyPdbPath: string;
  metricsJsonPath: string;
  initialPotentialEnergyKilojoulePerMole: number;
  finalPotentialEnergyKilojoulePerMole: number;
}

export interface LiatirMolecularDynamicsOutputs {
  trajectoryDcdPath: string;
  preparedStructurePath: string;
  finalStructurePath: string;
  topologyPdbPath: string;
  stateCsvPath: string;
  checkpointPath: string;
  checkpointMetadataPath: string;
  metricsJsonPath: string;
  energyPlotPath: string;
  temperaturePlotPath: string;
  frameCount: number;
  timestepFs: typeof OPENMM_TIMESTEP_FEMTOSECONDS;
}

export function validateRelaxationEnergyReduction(
  outputs: LiatirMolecularRelaxationOutputs,
): LiatirValidationResult {
  const errors: string[] = [];
  if (!Number.isFinite(outputs.initialPotentialEnergyKilojoulePerMole)
    || !Number.isFinite(outputs.finalPotentialEnergyKilojoulePerMole)) {
    errors.push("Relaxation energies must be finite.");
  } else if (outputs.finalPotentialEnergyKilojoulePerMole >= outputs.initialPotentialEnergyKilojoulePerMole) {
    errors.push("Molecular relaxation did not reduce potential energy.");
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}
