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
  /** Boltz accepts PDB/mmCIF; Protenix accepts local HHR/A3M template-search output. */
  format: "pdb" | "mmcif" | "hhr" | "a3m";
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

export interface LiatirComplexSpecParseResult extends LiatirComplexSpecValidation {
  spec: LiatirComplexSpec | null;
}

/** Read advanced user input without letting malformed JSON reach scientific adapters. */
export function parseLiatirComplexSpecJson(text: string): LiatirComplexSpecParseResult {
  const parsed = parseLiatirComplexSpecDraftJson(text);
  return { ...parsed, spec: parsed.valid ? parsed.spec : null };
}

/** Restore unfinished editor data safely, retaining well-shaped but scientifically invalid input. */
export function parseLiatirComplexSpecDraftJson(text: string): LiatirComplexSpecParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { valid: false, errors: ["Complex input must be valid JSON."], spec: null };
  }
  const errors: string[] = [];
  const object = (item: unknown): item is Record<string, unknown> =>
    typeof item === "object" && item !== null && !Array.isArray(item);
  const knownFields = (item: Record<string, unknown>, label: string, allowed: string[]) => {
    for (const key of Object.keys(item)) {
      if (!allowed.includes(key)) errors.push(`${label}.${key} is not supported; it would not be used by prediction.`);
    }
  };
  const fields = (item: Record<string, unknown>, label: string, required: Record<string, string>, optional: Record<string, string> = {}) => {
    for (const [key, type] of Object.entries(required)) {
      if (typeof item[key] !== type || (type === "number" && !Number.isFinite(item[key]))) errors.push(`${label}.${key} must be a ${type === "number" ? "finite number" : type}.`);
    }
    for (const [key, type] of Object.entries(optional)) {
      if (item[key] !== undefined && (typeof item[key] !== type || (type === "number" && !Number.isFinite(item[key])))) errors.push(`${label}.${key} must be a ${type === "number" ? "finite number" : type}.`);
    }
  };
  if (!object(value)) return { valid: false, errors: ["Complex input must be a JSON object."], spec: null };
  knownFields(value, "Complex", ["schemaVersion", "kind", "name", "entities", "templates", "constraints"]);
  fields(value, "Complex", { schemaVersion: "number", kind: "string" }, { name: "string" });
  if (!Array.isArray(value.entities)) errors.push("Complex.entities must be an array.");
  for (const [index, entity] of (Array.isArray(value.entities) ? value.entities : []).entries()) {
    const label = `Entity ${index + 1}`;
    if (!object(entity)) { errors.push(`${label} must be an object.`); continue; }
    fields(entity, label, { id: "string", type: "string" }, { copies: "number" });
    knownFields(entity, label, ["id", "type", "copies", ...(entity.type === "ligand" ? ["smiles", "ccdCode"] : ["sequence", "msa"])]);
    if (entity.type === "ligand") {
      fields(entity, label, {}, { smiles: "string", ccdCode: "string" });
    } else if (["protein", "dna", "rna"].includes(String(entity.type))) {
      fields(entity, label, { sequence: "string" });
      if (entity.msa !== undefined) {
        if (!object(entity.msa)) errors.push(`${label}.msa must be an object.`);
        else {
          knownFields(entity.msa, `${label}.msa`, ["format", "path"]);
          fields(entity.msa, `${label}.msa`, { path: "string" });
          if (entity.msa.format !== "a3m") errors.push(`${label}.msa.format must be a3m.`);
        }
      }
    } else errors.push(`${label}.type must be protein, dna, rna or ligand.`);
  }
  for (const key of ["templates", "constraints"] as const) {
    if (value[key] !== undefined && !Array.isArray(value[key])) errors.push(`Complex.${key} must be an array.`);
  }
  for (const [index, template] of (Array.isArray(value.templates) ? value.templates : []).entries()) {
    const label = `Template ${index + 1}`;
    if (!object(template)) { errors.push(`${label} must be an object.`); continue; }
    knownFields(template, label, ["id", "entityId", "path", "format", "chainId"]);
    fields(template, label, { id: "string", entityId: "string", path: "string" }, { chainId: "string" });
    if (!["pdb", "mmcif", "hhr", "a3m"].includes(String(template.format))) errors.push(`${label} has an unsupported format.`);
  }
  for (const [index, constraint] of (Array.isArray(value.constraints) ? value.constraints : []).entries()) {
    const label = `Constraint ${index + 1}`;
    if (!object(constraint)) { errors.push(`${label} must be an object.`); continue; }
    knownFields(constraint, label, ["type", "left", "right", ...(constraint.type === "distance" ? ["minDistanceAngstrom", "maxDistanceAngstrom"] : constraint.type === "contact" ? ["maxDistanceAngstrom"] : [])]);
    if (!["bond", "contact", "distance"].includes(String(constraint.type))) errors.push(`${label} has an unsupported type.`);
    fields(constraint, label, constraint.type === "distance" ? { maxDistanceAngstrom: "number" } : {},
      { minDistanceAngstrom: "number", maxDistanceAngstrom: "number" });
    for (const side of ["left", "right"] as const) {
      if (!object(constraint[side])) errors.push(`${label}.${side} must be an object.`);
      else {
        knownFields(constraint[side], `${label}.${side}`, ["entityId", "residue", "atom"]);
        fields(constraint[side], `${label}.${side}`, { entityId: "string" }, { residue: "number", atom: "string" });
      }
    }
  }
  if (errors.length) return { valid: false, errors, spec: null };
  const spec = value as unknown as LiatirComplexSpec;
  const validation = validateLiatirComplexSpec(spec);
  return { ...validation, spec };
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
