// @liatir/core — Single-cell RNA-seq contract
//
// A reference index is a directory of files, and a pipeline value is a file. So the step
// that builds an index emits this manifest instead — one small JSON file naming the
// directory and the maps beside it — and the step that quantifies reads it.
//
// The seam is deliberate. Liatir can build an unusual index on the machine or download a
// ready-made, verified index from its signed catalog. Neither quantification path has to change,
// because both producers write one of these.

export const LIATIR_SINGLE_CELL_INDEX_KIND = "liatir.single-cell-index" as const;

/** Extension of the manifest file, and what a quantification input accepts. */
export const LIATIR_SINGLE_CELL_INDEX_EXTENSION = "sc-index.json" as const;

/** Signed registry document containing the reference indexes Liatir can install. */
export const LIATIR_SINGLE_CELL_INDEX_CATALOG_KIND =
  "liatir.single-cell-index.catalog" as const;

/** Portable manifest stored at the root of every published index archive. */
export const LIATIR_SINGLE_CELL_INDEX_BUNDLE_KIND =
  "liatir.single-cell-index.bundle" as const;

/**
 * How the reference was expanded before indexing.
 *
 * `spliced+intronic` keeps the sequence between exons, so reads that come from unprocessed
 * transcripts are counted instead of thrown away. It is what makes a quantification
 * "USA mode": every gene is counted three times over — spliced, unspliced, and ambiguous.
 */
export type LiatirSingleCellReferenceType = "spliced+intronic";

export interface LiatirSingleCellIndexSourceAsset {
  url: string;
  /** GENCODE currently publishes MD5 values for its release files. */
  checksum: { algorithm: "md5" | "sha256"; value: string };
}

export interface LiatirSingleCellIndexCatalogEntry {
  /** Stable scientific identity, including the decisions that change quantification. */
  id: string;
  /** Version of this packaged index. Its bytes are immutable once published. */
  version: string;
  label: string;
  species: {
    commonName: string;
    scientificName: string;
    taxonId: number;
  };
  genome: {
    assembly: string;
    source: LiatirSingleCellIndexSourceAsset;
  };
  annotation: {
    provider: string;
    release: string;
    format: "gtf" | "gff3";
    source: LiatirSingleCellIndexSourceAsset;
  };
  referenceType: LiatirSingleCellReferenceType;
  /** Biological read length used to expand introns, not a download or machine setting. */
  readLength: number;
  archive: {
    format: "zip";
    url: string;
    sha256: string;
    sizeBytes: number;
  };
  toolchain: {
    simpleafVersion: string;
    piscemVersion: string;
    nativeToolsLockSha256: string;
  };
  provenance: {
    recipeSha256: string;
    sourceRevision: string;
    builtAt: string;
  };
}

export interface LiatirSingleCellIndexCatalog {
  schemaVersion: 2;
  kind: typeof LIATIR_SINGLE_CELL_INDEX_CATALOG_KIND;
  updatedAt: string;
  indexes: LiatirSingleCellIndexCatalogEntry[];
}

export interface LiatirSingleCellIndexBundleFile {
  path: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Machine-independent contents of a published archive.
 *
 * Absolute paths never leave the build machine. The desktop app verifies these files and then
 * writes the ordinary local `.sc-index.json` manifest with paths for the current machine.
 */
export interface LiatirSingleCellIndexBundleManifest {
  schemaVersion: 1;
  kind: typeof LIATIR_SINGLE_CELL_INDEX_BUNDLE_KIND;
  indexId: string;
  version: string;
  indexDir: string;
  t2gMap: string;
  geneIdToName?: string;
  files: LiatirSingleCellIndexBundleFile[];
}

export interface LiatirInstalledSingleCellIndex {
  id: string;
  version: string;
  label: string;
  archiveSha256: string;
  manifestPath: string;
  installDir: string;
  installedAt: string;
}

export interface LiatirSingleCellIndexCatalogResult {
  catalog: LiatirSingleCellIndexCatalog;
  /** A cached catalog remains usable offline because its signature was verified before storage. */
  source: "network" | "cache";
}

export interface LiatirSingleCellIndexInstallResult {
  installed: LiatirInstalledSingleCellIndex;
  reused: boolean;
}

export interface LiatirSingleCellIndexSources {
  genomeFasta: string;
  annotation: string;
  annotationFormat: "gtf" | "gff3";
}

export interface LiatirSingleCellIndexManifest {
  schemaVersion: 1;
  kind: typeof LIATIR_SINGLE_CELL_INDEX_KIND;
  /** Directory holding the index the mapper reads. */
  indexDir: string;
  /** Three-column transcript → gene → splicing-status map written beside the index. */
  t2gMap: string;
  /** Gene id → gene symbol map, present when the annotation carried symbols. */
  geneIdToName?: string;
  referenceType: LiatirSingleCellReferenceType;
  /** Read length the intronic sequences were padded for. */
  readLength: number;
  sources: LiatirSingleCellIndexSources;
  simpleafVersion?: string;
  /** ISO-8601 instant supplied by the host that built the index. */
  createdAt: string;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The single-cell index file is missing "${field}".`);
  }
  return value;
}

/**
 * Read an index manifest, refusing anything that is not one.
 *
 * A quantification that starts against a half-written or unrelated file wastes a long run
 * before failing, so every field it depends on is checked here rather than at first use.
 */
export function parseLiatirSingleCellIndexManifest(
  contents: string,
): LiatirSingleCellIndexManifest {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(contents) as Record<string, unknown>;
  } catch {
    throw new Error("The single-cell index file is not readable JSON.");
  }
  if (parsed?.kind !== LIATIR_SINGLE_CELL_INDEX_KIND) {
    throw new Error("That file is not a Liatir single-cell index.");
  }
  if (parsed.schemaVersion !== 1) {
    throw new Error(
      `This single-cell index was written by a newer version of Liatir (format ${String(parsed.schemaVersion)}).`,
    );
  }
  const sources = (parsed.sources ?? {}) as Record<string, unknown>;
  const readLength = parsed.readLength;
  if (typeof readLength !== "number" || !Number.isFinite(readLength) || readLength <= 0) {
    throw new Error('The single-cell index file is missing "readLength".');
  }
  return {
    schemaVersion: 1,
    kind: LIATIR_SINGLE_CELL_INDEX_KIND,
    indexDir: requireString(parsed.indexDir, "indexDir"),
    t2gMap: requireString(parsed.t2gMap, "t2gMap"),
    ...(typeof parsed.geneIdToName === "string" && parsed.geneIdToName.length > 0
      ? { geneIdToName: parsed.geneIdToName }
      : {}),
    referenceType: "spliced+intronic",
    readLength,
    sources: {
      genomeFasta: requireString(sources.genomeFasta, "sources.genomeFasta"),
      annotation: requireString(sources.annotation, "sources.annotation"),
      annotationFormat: sources.annotationFormat === "gff3" ? "gff3" : "gtf",
    },
    ...(typeof parsed.simpleafVersion === "string"
      ? { simpleafVersion: parsed.simpleafVersion }
      : {}),
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
  };
}

/**
 * Whether a UMI resolution mode produces whole counts.
 *
 * The `-em` modes share a read between the genes it could have come from, so a cell can end
 * up with 1.4 copies of a gene. That is a legitimate estimate and a legitimate matrix — but
 * it is not raw counts, and a tool that requires raw counts must be able to tell.
 */
export function liatirSingleCellCountsAreWhole(resolution: string): boolean {
  return !resolution.endsWith("-em");
}

const ENSEMBL_GENE_ID = /^ENS[A-Z]{0,6}G\d{6,}(\.\d+)?$/;

/**
 * The identifier namespace of a set of gene names, or `undefined` when it cannot be told.
 *
 * Ensembl gene ids are recognisable; gene symbols are arbitrary words and are not. Returning
 * `undefined` leaves the artifact partially validated, which is the truth — better than
 * naming a namespace on the strength of "it wasn't the other one".
 */
export function liatirSingleCellFeatureNamespace(
  geneIds: readonly string[],
): string | undefined {
  const sample = geneIds.filter((id) => id.length > 0).slice(0, 200);
  if (sample.length === 0) return undefined;
  const ensembl = sample.filter((id) => ENSEMBL_GENE_ID.test(id)).length;
  return ensembl / sample.length >= 0.9 ? "ensembl-gene-id" : undefined;
}
