import type { JsonValue } from "./index";

export const LIATIR_SCIENTIFIC_ARTIFACT_SCHEMA_VERSION = 1 as const;

export const LIATIR_ANNDATA_PROFILE_V1 = {
  id: "org.liatir.scientific.anndata",
  version: "1.0.0",
} as const;

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
