export const LIATIR_COMPLEX_SPEC_SCHEMA_VERSION = 1 as const;

export type LiatirComplexPolymerType = "protein" | "dna" | "rna";

export interface LiatirComplexLocalMsa {
  format: "a3m";
  path: string;
}

export interface LiatirComplexPolymerEntity {
  id: string;
  type: LiatirComplexPolymerType;
  sequence: string;
  copies?: number;
  /** Local alignment only. Network-backed MSA generation is deliberately outside this contract. */
  msa?: LiatirComplexLocalMsa;
}

export interface LiatirComplexLigandEntity {
  id: string;
  type: "ligand";
  copies?: number;
  /** Exactly one of SMILES or CCD must be supplied. */
  smiles?: string;
  ccdCode?: string;
}

export type LiatirComplexEntity = LiatirComplexPolymerEntity | LiatirComplexLigandEntity;

export interface LiatirComplexTemplate {
  id: string;
  entityId: string;
  path: string;
  format: "pdb" | "mmcif";
  chainId?: string;
}

export interface LiatirComplexAtomRef {
  entityId: string;
  residue?: number;
  atom?: string;
}

export type LiatirComplexConstraint =
  | {
      type: "contact";
      left: LiatirComplexAtomRef;
      right: LiatirComplexAtomRef;
      maxDistanceAngstrom?: number;
    }
  | {
      type: "distance";
      left: LiatirComplexAtomRef;
      right: LiatirComplexAtomRef;
      minDistanceAngstrom?: number;
      maxDistanceAngstrom: number;
    }
  | {
      type: "bond";
      left: LiatirComplexAtomRef;
      right: LiatirComplexAtomRef;
    };

/** Neutral complex input translated by model-specific Boltz and Protenix adapters. */
export interface LiatirComplexSpec {
  schemaVersion: typeof LIATIR_COMPLEX_SPEC_SCHEMA_VERSION;
  kind: "liatir-complex-spec";
  name?: string;
  entities: LiatirComplexEntity[];
  templates?: LiatirComplexTemplate[];
  constraints?: LiatirComplexConstraint[];
}

export interface LiatirComplexSpecValidation {
  valid: boolean;
  errors: string[];
}

const ENTITY_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PROTEIN_RE = /^[ACDEFGHIKLMNPQRSTVWYBXZJUO]+$/;
const NUCLEIC_RE = /^[ACGTUNRYKMSWBDHV]+$/;
const CCD_RE = /^[A-Z0-9]{1,5}$/;

function isLocalPath(path: string): boolean {
  const value = path.trim();
  if (!value || value.includes("\0")) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

/** Validate references and scientific invariants without changing or normalizing the user's input. */
export function validateLiatirComplexSpec(spec: LiatirComplexSpec): LiatirComplexSpecValidation {
  const errors: string[] = [];
  if (spec.schemaVersion !== LIATIR_COMPLEX_SPEC_SCHEMA_VERSION) {
    errors.push(`Unsupported LiatirComplexSpec schema version: ${spec.schemaVersion}.`);
  }
  if (spec.kind !== "liatir-complex-spec") errors.push("Complex spec kind must be liatir-complex-spec.");
  if (!Array.isArray(spec.entities) || spec.entities.length === 0) {
    errors.push("At least one complex entity is required.");
    return { valid: false, errors };
  }

  const ids = new Set<string>();
  for (const entity of spec.entities) {
    if (!ENTITY_ID_RE.test(entity.id)) errors.push(`Invalid entity id: ${entity.id}.`);
    if (ids.has(entity.id)) errors.push(`Duplicate entity id: ${entity.id}.`);
    ids.add(entity.id);
    if (entity.copies !== undefined && (!Number.isSafeInteger(entity.copies) || entity.copies < 1)) {
      errors.push(`Entity ${entity.id} copies must be a positive integer.`);
    }
    if (entity.type === "ligand") {
      if (Boolean(entity.smiles) === Boolean(entity.ccdCode)) {
        errors.push(`Ligand ${entity.id} must provide exactly one of SMILES or CCD.`);
      }
      if (entity.smiles !== undefined && !entity.smiles.trim()) errors.push(`Ligand ${entity.id} has an empty SMILES value.`);
      if (entity.ccdCode !== undefined && !CCD_RE.test(entity.ccdCode)) errors.push(`Ligand ${entity.id} has an invalid CCD code.`);
      continue;
    }
    const sequence = entity.sequence.replace(/\s/g, "").toUpperCase();
    if (!sequence) errors.push(`Entity ${entity.id} has an empty sequence.`);
    const sequencePattern = entity.type === "protein" ? PROTEIN_RE : NUCLEIC_RE;
    if (sequence && !sequencePattern.test(sequence)) errors.push(`Entity ${entity.id} contains invalid ${entity.type} sequence characters.`);
    if (entity.msa) {
      if (entity.type !== "protein") errors.push(`Only protein entity ${entity.id} may reference an A3M alignment.`);
      if (!isLocalPath(entity.msa.path)) errors.push(`Entity ${entity.id} MSA must use a local path.`);
    }
  }

  const templateIds = new Set<string>();
  for (const template of spec.templates ?? []) {
    if (!ENTITY_ID_RE.test(template.id) || templateIds.has(template.id)) errors.push(`Invalid or duplicate template id: ${template.id}.`);
    templateIds.add(template.id);
    if (!ids.has(template.entityId)) errors.push(`Template ${template.id} references unknown entity ${template.entityId}.`);
    if (!isLocalPath(template.path)) errors.push(`Template ${template.id} must use a local path.`);
  }

  for (const [index, constraint] of (spec.constraints ?? []).entries()) {
    for (const side of [constraint.left, constraint.right]) {
      if (!ids.has(side.entityId)) errors.push(`Constraint ${index + 1} references unknown entity ${side.entityId}.`);
      if (side.residue !== undefined && (!Number.isSafeInteger(side.residue) || side.residue < 1)) {
        errors.push(`Constraint ${index + 1} residue positions must be positive integers.`);
      }
    }
    if (constraint.type === "distance") {
      if (!(constraint.maxDistanceAngstrom > 0)) errors.push(`Constraint ${index + 1} maximum distance must be positive.`);
      if (constraint.minDistanceAngstrom !== undefined && (
        constraint.minDistanceAngstrom < 0 || constraint.minDistanceAngstrom > constraint.maxDistanceAngstrom
      )) errors.push(`Constraint ${index + 1} has an invalid distance range.`);
    }
    if (constraint.type === "contact" && constraint.maxDistanceAngstrom !== undefined && !(constraint.maxDistanceAngstrom > 0)) {
      errors.push(`Constraint ${index + 1} maximum contact distance must be positive.`);
    }
  }
  return { valid: errors.length === 0, errors };
}
