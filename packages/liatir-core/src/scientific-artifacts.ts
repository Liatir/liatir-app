import type { JsonValue } from "./index.js";

export const LIATIR_SCIENTIFIC_ARTIFACT_SCHEMA_VERSION = 1 as const;

export const LIATIR_ANNDATA_PROFILE_V1 = {
  id: "org.liatir.scientific.anndata",
  version: "1.0.0",
} as const;

export const LIATIR_FASTA_PROFILE_V1 = { id: "org.liatir.scientific.fasta", version: "1.0.0" } as const;
export const LIATIR_A3M_PROFILE_V1 = { id: "org.liatir.scientific.a3m", version: "1.0.0" } as const;
export const LIATIR_VEP_TUMOR_VCF_PROFILE_V1 = { id: "org.liatir.scientific.vep-tumor-vcf", version: "1.0.0" } as const;
export const LIATIR_STRUCTURE_PROFILE_V1 = { id: "org.liatir.scientific.molecular-structure", version: "1.0.0" } as const;
export const LIATIR_NEOANTIGEN_TSV_PROFILE_V1 = { id: "org.liatir.scientific.neoantigen-report", version: "1.0.0" } as const;
export const LIATIR_DCD_TRAJECTORY_PROFILE_V1 = { id: "org.liatir.scientific.dcd-trajectory", version: "1.0.0" } as const;

export type LiatirArtifactValidationStatus = "valid" | "partial" | "invalid";
export type LiatirArtifactDiagnosticSeverity = "info" | "warning" | "error";
export type LiatirArtifactCompatibilityStatus =
  | "compatible"
  | "partial"
  | "incompatible";
export type LiatirArtifactCompatibilityLayer =
  | "transport"
  | "format"
  | "scientific";

export interface LiatirArtifactProfileRef {
  id: string;
  version: string;
}

export interface LiatirArtifactDigest {
  algorithm: "sha256";
  value: string;
}

export interface LiatirArtifactFormat {
  id: string;
  version?: string;
  container?: string;
}

export interface LiatirArtifactPhysicalIdentity {
  /** Stable content identity. Liatir uses `sha256:<hex>` when a digest exists. */
  artifactId: string;
  sizeBytes: number;
  digest: LiatirArtifactDigest;
  mediaType: string;
  format: LiatirArtifactFormat;
}

export interface LiatirOrganismQualifier {
  taxonId?: string;
  name?: string;
}

export interface LiatirMatrixQualifier {
  location: string;
  observations?: number;
  variables?: number;
  sparse?: boolean;
  valueType?: string;
}

export interface LiatirArtifactQualifiers {
  organism?: LiatirOrganismQualifier;
  genomeAssembly?: string;
  referenceDigest?: LiatirArtifactDigest;
  coordinateSystem?: string;
  assay?: string;
  modality?: string;
  sampleIds?: string[];
  units?: string;
  featureNamespace?: string;
  preprocessing?: string[];
  matrix?: LiatirMatrixQualifier;
  representations?: string[];
  embeddingKeys?: string[];
  sequence?: {
    alphabet: "protein" | "dna" | "rna" | "mixed";
    count?: number;
    aligned?: boolean;
    alignmentColumns?: number;
  };
  variants?: {
    annotation: "vep";
    tumorSample?: string;
    normalSample?: string;
    sampleCount?: number;
    variantCount?: number;
  };
  structure?: {
    atomCount?: number;
    modelCount?: number;
    chainIds?: string[];
  };
  table?: {
    delimiter: "tab" | "comma";
    columns?: string[];
    rows?: number;
  };
  trajectory?: {
    format: "dcd";
    frameCount?: number;
    atomCount?: number;
    timestepFs?: number;
    initialStructureArtifactId: string;
    initialStructureDigest?: LiatirArtifactDigest;
  };
}

export interface LiatirArtifactDiagnostic {
  code: string;
  severity: LiatirArtifactDiagnosticSeverity;
  message: string;
  action?: string;
  layer?: LiatirArtifactCompatibilityLayer;
}

export interface LiatirArtifactValidation {
  profile: LiatirArtifactProfileRef;
  status: LiatirArtifactValidationStatus;
  validator: {
    id: string;
    version: string;
  };
  /** ISO-8601 instant supplied by the validating host. */
  validatedAt: string;
  diagnostics: LiatirArtifactDiagnostic[];
}

export interface LiatirArtifactLineageSource {
  artifactId: string;
  digest?: LiatirArtifactDigest;
  role?: string;
  fieldKey?: string;
}

export interface LiatirArtifactTransformation {
  id: string;
  label: string;
  version?: string;
  sourceRevision?: string;
  parameters?: Record<string, JsonValue>;
}

export interface LiatirArtifactLineage {
  sources: LiatirArtifactLineageSource[];
  transformation?: LiatirArtifactTransformation;
}

export interface LiatirArtifactViewerHints {
  preferredViewer?: string;
  indexes?: string[];
  [key: string]: JsonValue | undefined;
}

/**
 * Versioned semantic metadata attached to an ordinary Liatir file artifact.
 * The original file remains authoritative and immutable; this metadata never
 * replaces or rewrites the scientific format.
 */
export interface LiatirScientificArtifactMetadata {
  schemaVersion: typeof LIATIR_SCIENTIFIC_ARTIFACT_SCHEMA_VERSION;
  physical: LiatirArtifactPhysicalIdentity;
  profile: LiatirArtifactProfileRef;
  scientificType: string;
  qualifiers: LiatirArtifactQualifiers;
  validation: LiatirArtifactValidation;
  lineage?: LiatirArtifactLineage;
  viewerHints?: LiatirArtifactViewerHints;
  mutationPolicy: "immutable-source";
}

export interface LiatirArtifactQualifierRequirement {
  taxonIds?: string[];
  modalities?: string[];
  featureNamespaces?: string[];
  preprocessing?: string[];
  representations?: string[];
}

/** Scientific constraints declared by a file input. Unknown metadata is partial, never guessed. */
export interface LiatirArtifactRequirement {
  profiles?: LiatirArtifactProfileRef[];
  formats?: string[];
  scientificTypes?: string[];
  qualifiers?: LiatirArtifactQualifierRequirement;
  validation?: "valid" | "valid-or-partial";
}

/** Semantic promise declared by a file output before a concrete artifact exists. */
export interface LiatirArtifactDeclaration {
  profile: LiatirArtifactProfileRef;
  format: string;
  scientificType: string;
  qualifiers?: LiatirArtifactQualifiers;
}

export interface LiatirArtifactCompatibilityLayerResult {
  layer: LiatirArtifactCompatibilityLayer;
  status: LiatirArtifactCompatibilityStatus;
  diagnostics: LiatirArtifactDiagnostic[];
}

export interface LiatirArtifactCompatibilityReport {
  status: LiatirArtifactCompatibilityStatus;
  layers: {
    transport: LiatirArtifactCompatibilityLayerResult;
    format: LiatirArtifactCompatibilityLayerResult;
    scientific: LiatirArtifactCompatibilityLayerResult;
  };
  diagnostics: LiatirArtifactDiagnostic[];
}

export interface LiatirAnnDataInspectionV1 {
  hdf5Signature: boolean;
  observations?: number;
  variables?: number;
  matrixLocation?: string;
  matrixPresent?: boolean;
  finiteValues?: boolean;
  nonNegativeValues?: boolean;
  integerLikeValues?: boolean;
  sparse?: boolean;
  valueType?: string;
  scientificType?: string;
  organism?: LiatirOrganismQualifier;
  modality?: string;
  featureNamespace?: string;
  preprocessing?: string[];
  representations?: string[];
  embeddingKeys?: string[];
}

export interface ValidateLiatirAnnDataInput {
  sizeBytes: number;
  sha256: string;
  inspection: LiatirAnnDataInspectionV1;
  validatedAt: string;
  lineage?: LiatirArtifactLineage;
  viewerHints?: LiatirArtifactViewerHints;
}

interface ValidateLiatirProfileInput<TInspection> {
  sizeBytes: number;
  sha256: string;
  inspection: TInspection;
  validatedAt: string;
  lineage?: LiatirArtifactLineage;
  viewerHints?: LiatirArtifactViewerHints;
}

export interface LiatirSequenceInspectionV1 {
  headerPresent: boolean;
  sequenceCount?: number;
  alphabet?: "protein" | "dna" | "rna" | "mixed";
  validCharacters?: boolean;
  aligned?: boolean;
  alignmentColumns?: number;
}

export interface LiatirVepTumorVcfInspectionV1 {
  vcfHeader: boolean;
  csqHeader: boolean;
  genotypeFormat: boolean;
  sampleIds: string[];
  tumorSample?: string;
  normalSample?: string;
  variantCount?: number;
  wildtypeProteinAnnotation: boolean;
  frameshiftSequenceAnnotation: boolean;
}

export interface LiatirStructureInspectionV1 {
  format: "pdb" | "mmcif" | "sdf";
  recognizedFormat: boolean;
  atomCount?: number;
  modelCount?: number;
  chainIds?: string[];
  finiteCoordinates?: boolean;
}

export interface LiatirNeoantigenTsvInspectionV1 {
  tabDelimited: boolean;
  columns: string[];
  requiredColumns: string[];
  rowCount?: number;
  finiteScores?: boolean;
}

export interface LiatirDcdTrajectoryInspectionV1 {
  dcdSignature: boolean;
  frameCount?: number;
  atomCount?: number;
  topologyAtomCount?: number;
  finiteCoordinates?: boolean;
  timestepFs?: number;
  initialStructureArtifactId: string;
  initialStructureDigest?: LiatirArtifactDigest;
}

export type ValidateLiatirFastaInput = ValidateLiatirProfileInput<LiatirSequenceInspectionV1>;
export type ValidateLiatirA3mInput = ValidateLiatirProfileInput<LiatirSequenceInspectionV1>;
export type ValidateLiatirVepTumorVcfInput = ValidateLiatirProfileInput<LiatirVepTumorVcfInspectionV1>;
export type ValidateLiatirStructureInput = ValidateLiatirProfileInput<LiatirStructureInspectionV1>;
export type ValidateLiatirNeoantigenTsvInput = ValidateLiatirProfileInput<LiatirNeoantigenTsvInspectionV1>;
export type ValidateLiatirDcdTrajectoryInput = ValidateLiatirProfileInput<LiatirDcdTrajectoryInspectionV1>;

const SHA256_RE = /^[a-f0-9]{64}$/;

function diagnostic(
  code: string,
  severity: LiatirArtifactDiagnosticSeverity,
  message: string,
  action?: string,
  layer?: LiatirArtifactCompatibilityLayer,
): LiatirArtifactDiagnostic {
  return { code, severity, message, ...(action ? { action } : {}), ...(layer ? { layer } : {}) };
}

function validationStatus(diagnostics: LiatirArtifactDiagnostic[]): LiatirArtifactValidationStatus {
  if (diagnostics.some((item) => item.severity === "error")) return "invalid";
  if (diagnostics.some((item) => item.severity === "warning")) return "partial";
  return "valid";
}

function validatePhysicalInput(
  input: { sizeBytes: number; sha256: string },
  diagnostics: LiatirArtifactDiagnostic[],
) {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    diagnostics.push(diagnostic(
      "artifact.file.empty", "error", "The scientific file is empty or its size is unavailable.",
      "Choose a readable, non-empty file.", "transport",
    ));
  }
  if (!SHA256_RE.test(input.sha256)) {
    diagnostics.push(diagnostic(
      "artifact.digest.invalid", "error", "The artifact does not have a valid SHA-256 content identity.",
      "Re-inspect the file before using it.", "transport",
    ));
  }
}

function profileMetadata<TInspection>(
  input: ValidateLiatirProfileInput<TInspection>,
  profile: LiatirArtifactProfileRef,
  validatorId: string,
  format: LiatirArtifactFormat,
  mediaType: string,
  scientificType: string,
  qualifiers: LiatirArtifactQualifiers,
  diagnostics: LiatirArtifactDiagnostic[],
): LiatirScientificArtifactMetadata {
  const digest: LiatirArtifactDigest = { algorithm: "sha256", value: input.sha256 };
  return {
    schemaVersion: LIATIR_SCIENTIFIC_ARTIFACT_SCHEMA_VERSION,
    physical: {
      artifactId: `sha256:${input.sha256}`,
      sizeBytes: input.sizeBytes,
      digest,
      mediaType,
      format,
    },
    profile,
    scientificType,
    qualifiers,
    validation: {
      profile,
      status: validationStatus(diagnostics),
      validator: { id: validatorId, version: "1.0.0" },
      validatedAt: input.validatedAt,
      diagnostics,
    },
    ...(input.lineage ? { lineage: input.lineage } : {}),
    ...(input.viewerHints ? { viewerHints: input.viewerHints } : {}),
    mutationPolicy: "immutable-source",
  };
}

function validateSequenceArtifact(
  input: ValidateLiatirFastaInput,
  alignment: boolean,
): LiatirScientificArtifactMetadata {
  const diagnostics: LiatirArtifactDiagnostic[] = [];
  const inspection = input.inspection;
  validatePhysicalInput(input, diagnostics);
  if (!inspection.headerPresent) diagnostics.push(diagnostic(
    "sequence.header.missing", "error", "The file has no FASTA sequence header.",
    "Choose a FASTA file whose records start with >.", "format",
  ));
  if (inspection.sequenceCount === undefined) diagnostics.push(diagnostic(
    "sequence.count.unknown", "warning", "The number of sequences has not been inspected.",
    "Inspect all sequence records before running a scientific tool.", "scientific",
  ));
  else if (!Number.isSafeInteger(inspection.sequenceCount) || inspection.sequenceCount < 1) diagnostics.push(diagnostic(
    "sequence.count.invalid", "error", "The file contains no complete sequence records.",
    "Choose a non-empty FASTA or A3M file.", "scientific",
  ));
  if (inspection.validCharacters === false) diagnostics.push(diagnostic(
    "sequence.characters.invalid", "error", "The file contains characters outside its declared sequence alphabet.",
    "Correct the sequence or declare the intended alphabet in a new artifact.", "scientific",
  ));
  else if (inspection.validCharacters === undefined || !inspection.alphabet) diagnostics.push(diagnostic(
    "sequence.alphabet.unknown", "warning", "The sequence alphabet has not been fully validated.",
    "Validate whether the file contains protein, DNA, or RNA sequences.", "scientific",
  ));
  if (alignment && inspection.aligned !== true) diagnostics.push(diagnostic(
    "a3m.alignment.invalid", inspection.aligned === false ? "error" : "warning",
    inspection.aligned === false ? "The A3M records do not describe one consistent alignment." : "The A3M alignment width has not been inspected.",
    "Validate the A3M alignment before using it as model input.", "scientific",
  ));
  const profile = alignment ? { ...LIATIR_A3M_PROFILE_V1 } : { ...LIATIR_FASTA_PROFILE_V1 };
  return profileMetadata(
    input, profile, alignment ? "org.liatir.validator.a3m" : "org.liatir.validator.fasta",
    { id: alignment ? "a3m" : "fasta" }, "text/plain", alignment ? "multiple-sequence-alignment" : "biological-sequences",
    {
      sequence: {
        alphabet: inspection.alphabet ?? "mixed",
        ...(inspection.sequenceCount !== undefined ? { count: inspection.sequenceCount } : {}),
        ...(alignment ? { aligned: inspection.aligned ?? false } : {}),
        ...(inspection.alignmentColumns !== undefined ? { alignmentColumns: inspection.alignmentColumns } : {}),
      },
    }, diagnostics,
  );
}

export function validateLiatirFastaArtifact(input: ValidateLiatirFastaInput): LiatirScientificArtifactMetadata {
  return validateSequenceArtifact(input, false);
}

export function validateLiatirA3mArtifact(input: ValidateLiatirA3mInput): LiatirScientificArtifactMetadata {
  return validateSequenceArtifact(input, true);
}

export function validateLiatirVepTumorVcfArtifact(input: ValidateLiatirVepTumorVcfInput): LiatirScientificArtifactMetadata {
  const diagnostics: LiatirArtifactDiagnostic[] = [];
  const inspection = input.inspection;
  validatePhysicalInput(input, diagnostics);
  for (const [ok, code, message, action, layer] of [
    [inspection.vcfHeader, "vep-vcf.header.missing", "The file has no VCF header.", "Choose a valid VCF file.", "format"],
    [inspection.csqHeader, "vep-vcf.csq.missing", "The VCF has no VEP CSQ annotation header.", "Annotate the VCF with VEP before using it for neoantigen prioritization.", "scientific"],
    [inspection.genotypeFormat, "vep-vcf.genotype.missing", "The VCF has no genotype data.", "Include GT genotypes for the selected samples.", "scientific"],
    [inspection.wildtypeProteinAnnotation, "vep-vcf.wildtype-protein.missing", "VEP WildtypeProtein annotations are missing.", "Run the required VEP plugin annotations before prioritization.", "scientific"],
    [inspection.frameshiftSequenceAnnotation, "vep-vcf.frameshift-sequence.missing", "VEP FrameshiftSequence annotations are missing.", "Run the required VEP plugin annotations before prioritization.", "scientific"],
  ] as const) if (!ok) diagnostics.push(diagnostic(code, "error", message, action, layer));
  if (!inspection.tumorSample || !inspection.sampleIds.includes(inspection.tumorSample)) diagnostics.push(diagnostic(
    "vep-vcf.tumor-sample.missing", "error", "The selected tumor sample is not present in the VCF.",
    "Choose one of the samples declared in the VCF header.", "scientific",
  ));
  if (inspection.normalSample && !inspection.sampleIds.includes(inspection.normalSample)) diagnostics.push(diagnostic(
    "vep-vcf.normal-sample.missing", "error", "The selected normal sample is not present in the VCF.",
    "Choose one of the samples declared in the VCF header.", "scientific",
  ));
  return profileMetadata(input, { ...LIATIR_VEP_TUMOR_VCF_PROFILE_V1 }, "org.liatir.validator.vep-tumor-vcf",
    { id: "vcf" }, "text/vcf", "vep-annotated-tumor-variants", {
      sampleIds: inspection.sampleIds,
      variants: {
        annotation: "vep",
        ...(inspection.tumorSample ? { tumorSample: inspection.tumorSample } : {}),
        ...(inspection.normalSample ? { normalSample: inspection.normalSample } : {}),
        sampleCount: inspection.sampleIds.length,
        ...(inspection.variantCount !== undefined ? { variantCount: inspection.variantCount } : {}),
      },
    }, diagnostics);
}

export function validateLiatirStructureArtifact(input: ValidateLiatirStructureInput): LiatirScientificArtifactMetadata {
  const diagnostics: LiatirArtifactDiagnostic[] = [];
  const inspection = input.inspection;
  validatePhysicalInput(input, diagnostics);
  if (!inspection.recognizedFormat) diagnostics.push(diagnostic(
    "structure.format.invalid", "error", `The file does not match the declared ${inspection.format} structure format.`,
    "Choose an unmodified PDB, mmCIF, or SDF structure file.", "format",
  ));
  if (inspection.atomCount === undefined) diagnostics.push(diagnostic(
    "structure.atoms.unknown", "warning", "The structure atom count has not been inspected.",
    "Inspect the structure topology before running a model.", "scientific",
  ));
  else if (!Number.isSafeInteger(inspection.atomCount) || inspection.atomCount < 1) diagnostics.push(diagnostic(
    "structure.atoms.invalid", "error", "The structure contains no atoms.", "Choose a non-empty molecular structure.", "scientific",
  ));
  if (inspection.finiteCoordinates !== true) diagnostics.push(diagnostic(
    "structure.coordinates.non-finite", inspection.finiteCoordinates === false ? "error" : "warning",
    inspection.finiteCoordinates === false ? "The structure contains non-finite coordinates." : "The structure coordinates have not been checked for finite values.",
    "Validate every atom coordinate before scientific execution.", "scientific",
  ));
  const mediaType = inspection.format === "pdb" ? "chemical/x-pdb" : inspection.format === "sdf" ? "chemical/x-mdl-sdfile" : "chemical/x-mmcif";
  return profileMetadata(input, { ...LIATIR_STRUCTURE_PROFILE_V1 }, "org.liatir.validator.molecular-structure",
    { id: inspection.format }, mediaType, "molecular-structure", {
      structure: {
        ...(inspection.atomCount !== undefined ? { atomCount: inspection.atomCount } : {}),
        ...(inspection.modelCount !== undefined ? { modelCount: inspection.modelCount } : {}),
        ...(inspection.chainIds ? { chainIds: inspection.chainIds } : {}),
      },
    }, diagnostics);
}

export function validateLiatirNeoantigenTsvArtifact(input: ValidateLiatirNeoantigenTsvInput): LiatirScientificArtifactMetadata {
  const diagnostics: LiatirArtifactDiagnostic[] = [];
  const inspection = input.inspection;
  validatePhysicalInput(input, diagnostics);
  if (!inspection.tabDelimited) diagnostics.push(diagnostic(
    "neoantigen-report.delimiter.invalid", "error", "The neoantigen report is not tab-delimited.",
    "Choose the TSV report produced by the prioritization run.", "format",
  ));
  const missing = inspection.requiredColumns.filter((column) => !inspection.columns.includes(column));
  if (missing.length) diagnostics.push(diagnostic(
    "neoantigen-report.columns.missing", "error", `The report is missing required columns: ${missing.join(", ")}.`,
    "Use the complete aggregated neoantigen report.", "scientific",
  ));
  if (inspection.finiteScores === false) diagnostics.push(diagnostic(
    "neoantigen-report.scores.non-finite", "error", "The report contains non-finite ranking scores.",
    "Inspect the failed predictor rows before ranking candidates.", "scientific",
  ));
  return profileMetadata(input, { ...LIATIR_NEOANTIGEN_TSV_PROFILE_V1 }, "org.liatir.validator.neoantigen-report",
    { id: "tsv" }, "text/tab-separated-values", "neoantigen-candidate-report", {
      table: { delimiter: "tab", columns: inspection.columns, ...(inspection.rowCount !== undefined ? { rows: inspection.rowCount } : {}) },
    }, diagnostics);
}

export function validateLiatirDcdTrajectoryArtifact(input: ValidateLiatirDcdTrajectoryInput): LiatirScientificArtifactMetadata {
  const diagnostics: LiatirArtifactDiagnostic[] = [];
  const inspection = input.inspection;
  validatePhysicalInput(input, diagnostics);
  if (!inspection.dcdSignature) diagnostics.push(diagnostic(
    "dcd.signature.invalid", "error", "The file does not have a supported DCD trajectory header.",
    "Choose a standard CHARMM/NAMD DCD trajectory.", "format",
  ));
  if (!/^sha256:[a-f0-9]{64}$/.test(inspection.initialStructureArtifactId)) diagnostics.push(diagnostic(
    "dcd.topology.missing", "error", "The trajectory is not linked to its initial structure.",
    "Attach the exact structure used to create the trajectory.", "scientific",
  ));
  if (inspection.initialStructureDigest && `sha256:${inspection.initialStructureDigest.value}` !== inspection.initialStructureArtifactId) {
    diagnostics.push(diagnostic(
      "dcd.topology.digest-mismatch", "error", "The linked structure digest does not match its artifact identity.",
      "Re-link the exact immutable starting structure.", "transport",
    ));
  }
  for (const [value, code, label] of [
    [inspection.frameCount, "dcd.frames.invalid", "frame"],
    [inspection.atomCount, "dcd.atoms.invalid", "atom"],
  ] as const) {
    if (value === undefined) diagnostics.push(diagnostic(
      `${code}.unknown`, "warning", `The trajectory ${label} count has not been inspected.`,
      "Inspect the complete DCD header before playback or reuse.", "scientific",
    ));
    else if (!Number.isSafeInteger(value) || value < 1) diagnostics.push(diagnostic(
      code, "error", `The trajectory ${label} count is invalid.`, "Choose a non-empty trajectory.", "scientific",
    ));
  }
  if (inspection.atomCount !== undefined && inspection.topologyAtomCount !== undefined && inspection.atomCount !== inspection.topologyAtomCount) {
    diagnostics.push(diagnostic(
      "dcd.topology.atom-count-mismatch", "error", "The trajectory atom count does not match its initial structure.",
      "Attach the exact topology used for this simulation.", "scientific",
    ));
  }
  if (inspection.finiteCoordinates !== true) diagnostics.push(diagnostic(
    "dcd.coordinates.non-finite", inspection.finiteCoordinates === false ? "error" : "warning",
    inspection.finiteCoordinates === false ? "The trajectory contains non-finite coordinates." : "The trajectory coordinates have not been checked for finite values.",
    "Validate every saved frame before interpreting the simulation.", "scientific",
  ));
  return profileMetadata(input, { ...LIATIR_DCD_TRAJECTORY_PROFILE_V1 }, "org.liatir.validator.dcd-trajectory",
    { id: "dcd" }, "chemical/x-dcd", "molecular-dynamics-trajectory", {
      trajectory: {
        format: "dcd",
        initialStructureArtifactId: inspection.initialStructureArtifactId,
        ...(inspection.initialStructureDigest ? { initialStructureDigest: inspection.initialStructureDigest } : {}),
        ...(inspection.frameCount !== undefined ? { frameCount: inspection.frameCount } : {}),
        ...(inspection.atomCount !== undefined ? { atomCount: inspection.atomCount } : {}),
        ...(inspection.timestepFs !== undefined ? { timestepFs: inspection.timestepFs } : {}),
      },
    }, diagnostics);
}

/** Build and validate the first versioned Liatir scientific profile: AnnData/H5AD. */
export function validateLiatirAnnDataArtifact(
  input: ValidateLiatirAnnDataInput,
): LiatirScientificArtifactMetadata {
  const diagnostics: LiatirArtifactDiagnostic[] = [];
  const inspection = input.inspection;

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    diagnostics.push(diagnostic(
      "anndata.file.empty",
      "error",
      "The AnnData file is empty or its size is unavailable.",
      "Choose a readable, non-empty .h5ad file.",
      "transport",
    ));
  }
  if (!SHA256_RE.test(input.sha256)) {
    diagnostics.push(diagnostic(
      "artifact.digest.invalid",
      "error",
      "The artifact does not have a valid SHA-256 content identity.",
      "Re-inspect the file before using it.",
      "transport",
    ));
  }
  if (!inspection.hdf5Signature) {
    diagnostics.push(diagnostic(
      "anndata.container.invalid",
      "error",
      "The file does not have the HDF5 signature required by AnnData .h5ad.",
      "Choose an AnnData .h5ad file rather than a renamed file.",
      "format",
    ));
  }

  if (inspection.observations === undefined || inspection.variables === undefined) {
    diagnostics.push(diagnostic(
      "anndata.shape.unknown",
      "warning",
      "The AnnData matrix shape has not been inspected yet.",
      "Validate the dataset with an AnnData-aware tool before relying on scientific compatibility.",
      "scientific",
    ));
  } else if (
    !Number.isSafeInteger(inspection.observations) || inspection.observations <= 0 ||
    !Number.isSafeInteger(inspection.variables) || inspection.variables <= 0
  ) {
    diagnostics.push(diagnostic(
      "anndata.shape.invalid",
      "error",
      "AnnData must contain at least one observation and one variable.",
      "Choose a non-empty dataset.",
      "scientific",
    ));
  }

  if (inspection.matrixPresent === false) {
    diagnostics.push(diagnostic(
      "anndata.matrix.missing",
      "error",
      `The required matrix ${inspection.matrixLocation ?? ".X"} is missing.`,
      "Select the intended matrix or create a new derived artifact with an explicit conversion.",
      "scientific",
    ));
  } else if (inspection.matrixPresent === undefined) {
    diagnostics.push(diagnostic(
      "anndata.matrix.unknown",
      "warning",
      "The expression matrix has not been inspected yet.",
      "Validate the dataset before expensive scientific execution.",
      "scientific",
    ));
  }

  for (const [value, code, label, message] of [
    [inspection.finiteValues, "anndata.values.non-finite", "finite values", "The selected matrix contains non-finite values."],
    [inspection.nonNegativeValues, "anndata.values.negative", "non-negative values", "The selected matrix contains negative values."],
  ] as const) {
    if (value === false) {
      diagnostics.push(diagnostic(
        code,
        "error",
        message,
        "Create a new corrected artifact; do not mutate the original input.",
        "scientific",
      ));
    } else if (value === undefined) {
      diagnostics.push(diagnostic(
        `${code}.unknown`,
        "warning",
        `The selected matrix has not been checked for ${label}.`,
        "Validate the matrix values before treating this artifact as fully validated.",
        "scientific",
      ));
    }
  }

  if (inspection.preprocessing?.includes("raw-counts")) {
    if (inspection.integerLikeValues === false) {
      diagnostics.push(diagnostic(
        "anndata.values.non-integer-counts",
        "error",
        "The matrix is declared as raw counts but contains too many non-integer-like values.",
        "Use the raw-count matrix or create a new artifact with the correct preprocessing declaration.",
        "scientific",
      ));
    } else if (inspection.integerLikeValues === undefined) {
      diagnostics.push(diagnostic(
        "anndata.values.integer-counts.unknown",
        "warning",
        "The raw-count declaration has not been checked against matrix values.",
        "Validate that the selected matrix contains integer-like counts.",
        "scientific",
      ));
    }
  }

  if (!inspection.modality) {
    diagnostics.push(diagnostic(
      "artifact.modality.unknown",
      "warning",
      "The scientific modality is unknown.",
      "Declare or validate the modality before connecting a modality-specific tool.",
      "scientific",
    ));
  }
  if (!inspection.featureNamespace) {
    diagnostics.push(diagnostic(
      "artifact.feature-namespace.unknown",
      "warning",
      "The feature identifier namespace is unknown.",
      "Validate whether features are gene symbols, Ensembl IDs, or another namespace.",
      "scientific",
    ));
  }
  if (!inspection.preprocessing || inspection.preprocessing.length === 0) {
    diagnostics.push(diagnostic(
      "artifact.preprocessing.unknown",
      "warning",
      "The preprocessing state is unknown.",
      "Confirm whether the selected matrix contains raw counts, normalized values, or another representation.",
      "scientific",
    ));
  }

  const digest: LiatirArtifactDigest = { algorithm: "sha256", value: input.sha256 };
  return {
    schemaVersion: LIATIR_SCIENTIFIC_ARTIFACT_SCHEMA_VERSION,
    physical: {
      artifactId: `sha256:${input.sha256}`,
      sizeBytes: input.sizeBytes,
      digest,
      mediaType: "application/x-hdf5",
      format: { id: "anndata-h5ad", container: "hdf5" },
    },
    profile: { ...LIATIR_ANNDATA_PROFILE_V1 },
    scientificType: inspection.scientificType ?? "annotated-matrix",
    qualifiers: {
      ...(inspection.organism ? { organism: inspection.organism } : {}),
      ...(inspection.modality ? { modality: inspection.modality } : {}),
      ...(inspection.featureNamespace ? { featureNamespace: inspection.featureNamespace } : {}),
      ...(inspection.preprocessing ? { preprocessing: inspection.preprocessing } : {}),
      ...(
        inspection.matrixLocation || inspection.observations !== undefined || inspection.variables !== undefined
          ? {
              matrix: {
                location: inspection.matrixLocation ?? "X",
                ...(inspection.observations !== undefined ? { observations: inspection.observations } : {}),
                ...(inspection.variables !== undefined ? { variables: inspection.variables } : {}),
                ...(inspection.sparse !== undefined ? { sparse: inspection.sparse } : {}),
                ...(inspection.valueType ? { valueType: inspection.valueType } : {}),
              },
            }
          : {}
      ),
      ...(inspection.representations ? { representations: inspection.representations } : {}),
      ...(inspection.embeddingKeys ? { embeddingKeys: inspection.embeddingKeys } : {}),
    },
    validation: {
      profile: { ...LIATIR_ANNDATA_PROFILE_V1 },
      status: validationStatus(diagnostics),
      validator: { id: "org.liatir.validator.anndata", version: "1.0.0" },
      validatedAt: input.validatedAt,
      diagnostics,
    },
    ...(input.lineage ? { lineage: input.lineage } : {}),
    ...(input.viewerHints ? { viewerHints: input.viewerHints } : {}),
    mutationPolicy: "immutable-source",
  };
}

function layerResult(
  layer: LiatirArtifactCompatibilityLayer,
  diagnostics: LiatirArtifactDiagnostic[],
): LiatirArtifactCompatibilityLayerResult {
  const status = diagnostics.some((item) => item.severity === "error")
    ? "incompatible"
    : diagnostics.some((item) => item.severity === "warning")
      ? "partial"
      : "compatible";
  return { layer, status, diagnostics };
}

function includesRequired(actual: string[] | undefined, required: string[] | undefined): boolean | undefined {
  if (!required || required.length === 0) return true;
  if (!actual || actual.length === 0) return undefined;
  return required.every((item) => actual.includes(item));
}

function parseProfileVersion(version: string): [number, number, number] | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * Profile minor and patch releases are backwards compatible within one major
 * version. A requirement names the oldest compatible profile it understands.
 */
function profileSatisfies(
  actual: LiatirArtifactProfileRef,
  required: LiatirArtifactProfileRef,
): boolean {
  if (actual.id !== required.id) return false;
  const actualVersion = parseProfileVersion(actual.version);
  const requiredVersion = parseProfileVersion(required.version);
  if (!actualVersion || !requiredVersion || actualVersion[0] !== requiredVersion[0]) return false;
  if (actualVersion[1] !== requiredVersion[1]) return actualVersion[1] > requiredVersion[1];
  return actualVersion[2] >= requiredVersion[2];
}

/** Compare a concrete artifact to a consumer without collapsing three compatibility layers. */
export function checkLiatirArtifactCompatibility(
  artifact: LiatirScientificArtifactMetadata | undefined,
  requirement: LiatirArtifactRequirement,
): LiatirArtifactCompatibilityReport {
  const transportDiagnostics: LiatirArtifactDiagnostic[] = [];
  const formatDiagnostics: LiatirArtifactDiagnostic[] = [];
  const scientificDiagnostics: LiatirArtifactDiagnostic[] = [];

  if (!artifact) {
    transportDiagnostics.push(diagnostic(
      "artifact.metadata.missing",
      "warning",
      "This legacy file has no versioned artifact metadata yet.",
      "Inspect the file before relying on compatibility beyond its path and extension.",
      "transport",
    ));
    if (requirement.profiles?.length || requirement.formats?.length) {
      formatDiagnostics.push(diagnostic(
        "artifact.format-metadata.missing",
        "warning",
        "The file format and versioned profile have not been inspected yet.",
        "Inspect the file before relying on format compatibility.",
        "format",
      ));
    }
    if (
      requirement.scientificTypes?.length || requirement.qualifiers || requirement.validation
    ) {
      scientificDiagnostics.push(diagnostic(
        "artifact.scientific-metadata.missing",
        "warning",
        "The file has no scientific compatibility metadata yet.",
        "Validate the file before relying on scientific compatibility.",
        "scientific",
      ));
    }
  } else {
    if (
      !SHA256_RE.test(artifact.physical.digest.value) ||
      artifact.physical.artifactId !== `sha256:${artifact.physical.digest.value}` ||
      !Number.isSafeInteger(artifact.physical.sizeBytes) ||
      artifact.physical.sizeBytes <= 0
    ) {
      transportDiagnostics.push(diagnostic(
        "artifact.identity.invalid",
        "error",
        "The artifact content identity is invalid.",
        "Re-inspect the original file.",
        "transport",
      ));
    }

    if (artifact.validation.status === "invalid") {
      for (const item of artifact.validation.diagnostics.filter((diagnostic) => diagnostic.severity === "error")) {
        if (item.layer === "transport") transportDiagnostics.push(item);
        else if (item.layer === "scientific") scientificDiagnostics.push(item);
        else formatDiagnostics.push(item);
      }
    } else if (requirement.validation === "valid" && artifact.validation.status !== "valid") {
      scientificDiagnostics.push(diagnostic(
        "artifact.validation.incomplete",
        "warning",
        "The consumer requires complete validation, but the artifact is only partially described.",
        "Complete profile validation before running this consumer.",
        "scientific",
      ));
    }

    if (
      requirement.profiles?.length &&
      !requirement.profiles.some((profile) => profileSatisfies(artifact.profile, profile))
    ) {
      formatDiagnostics.push(diagnostic(
        "artifact.profile.mismatch",
        "error",
        `The artifact profile ${artifact.profile.id}@${artifact.profile.version} is not accepted.`,
        `Use one of: ${requirement.profiles.map((item) => `${item.id}@${item.version}`).join(", ")}.`,
        "format",
      ));
    }
    if (requirement.formats?.length && !requirement.formats.includes(artifact.physical.format.id)) {
      formatDiagnostics.push(diagnostic(
        "artifact.format.mismatch",
        "error",
        `The ${artifact.physical.format.id} format is not accepted by this input.`,
        `Use one of: ${requirement.formats.join(", ")}.`,
        "format",
      ));
    }
    if (
      requirement.scientificTypes?.length &&
      !requirement.scientificTypes.includes(artifact.scientificType)
    ) {
      scientificDiagnostics.push(diagnostic(
        "artifact.scientific-type.mismatch",
        "error",
        `The artifact scientific type ${artifact.scientificType} is not compatible with this input.`,
        `Use one of: ${requirement.scientificTypes.join(", ")}.`,
        "scientific",
      ));
    }

    const qualifiers = requirement.qualifiers;
    if (qualifiers) {
      const comparisons: Array<{
        code: string;
        label: string;
        actual: string | undefined;
        expected: string[] | undefined;
      }> = [
        {
          code: "artifact.organism.mismatch",
          label: "organism",
          actual: artifact.qualifiers.organism?.taxonId,
          expected: qualifiers.taxonIds,
        },
        {
          code: "artifact.modality.mismatch",
          label: "modality",
          actual: artifact.qualifiers.modality,
          expected: qualifiers.modalities,
        },
        {
          code: "artifact.feature-namespace.mismatch",
          label: "feature namespace",
          actual: artifact.qualifiers.featureNamespace,
          expected: qualifiers.featureNamespaces,
        },
      ];
      for (const comparison of comparisons) {
        if (!comparison.expected?.length) continue;
        if (!comparison.actual) {
          scientificDiagnostics.push(diagnostic(
            comparison.code.replace(".mismatch", ".unknown"),
            "warning",
            `The artifact ${comparison.label} is unknown.`,
            `Confirm one of: ${comparison.expected.join(", ")}.`,
            "scientific",
          ));
        } else if (!comparison.expected.includes(comparison.actual)) {
          scientificDiagnostics.push(diagnostic(
            comparison.code,
            "error",
            `The artifact ${comparison.label} is ${comparison.actual}, but this input requires ${comparison.expected.join(" or ")}.`,
            "Choose a compatible artifact or create an explicit, traceable transformation.",
            "scientific",
          ));
        }
      }

      for (const [code, label, actual, expected] of [
        ["artifact.preprocessing.mismatch", "preprocessing state", artifact.qualifiers.preprocessing, qualifiers.preprocessing],
        ["artifact.representation.mismatch", "representation", artifact.qualifiers.representations, qualifiers.representations],
      ] as const) {
        const match = includesRequired(actual, expected);
        if (match === undefined) {
          scientificDiagnostics.push(diagnostic(
            code.replace(".mismatch", ".unknown"),
            "warning",
            `The artifact ${label} is unknown.`,
            `Confirm the required value: ${(expected ?? []).join(", ")}.`,
            "scientific",
          ));
        } else if (!match) {
          scientificDiagnostics.push(diagnostic(
            code,
            "error",
            `The artifact does not provide the required ${label}: ${(expected ?? []).join(", ")}.`,
            "Create a new compatible artifact through an explicit transformation.",
            "scientific",
          ));
        }
      }
    }
  }

  const layers = {
    transport: layerResult("transport", transportDiagnostics),
    format: layerResult("format", formatDiagnostics),
    scientific: layerResult("scientific", scientificDiagnostics),
  };
  const diagnostics = [...transportDiagnostics, ...formatDiagnostics, ...scientificDiagnostics];
  const statuses = Object.values(layers).map((layer) => layer.status);
  const status = statuses.includes("incompatible")
    ? "incompatible"
    : statuses.includes("partial")
      ? "partial"
      : "compatible";
  return { status, layers, diagnostics };
}

export function liatirArtifactLineageSource(
  artifact: LiatirScientificArtifactMetadata,
  role?: string,
  fieldKey?: string,
): LiatirArtifactLineageSource {
  return {
    artifactId: artifact.physical.artifactId,
    digest: artifact.physical.digest,
    ...(role ? { role } : {}),
    ...(fieldKey ? { fieldKey } : {}),
  };
}
