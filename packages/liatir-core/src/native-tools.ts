// @liatir/core — Native Tools Catalog
//
// Single source of truth for bioinformatics tools bundled with Liatir.
// The SDK (@liatir/api), frontend, and backend all derive from this catalog.

/**
 * Metadata for a native bioinformatics tool bundled with Liatir.
 */
export interface LiatirNativeToolMetadata {
  /** Unique identifier (matches binary name). */
  id: string;
  /** Binary name (used in CLI). */
  name: string;
  /** Human-readable display name. */
  displayName: string;
  /** Short description of the tool's purpose. */
  description: string;
  /** Category for grouping in UI (e.g., "Alignment", "QC", "Variant Calling"). */
  category: string;
  /** Tool version bundled with Liatir. */
  version?: string;
  /** Binary name in bundle.externalBin (no platform suffix). */
  binaryName: string;
  /** Tags for filtering and search. */
  tags?: string[];
}

// ── Tool IDs ─────────────────────────────────────────────────────────────────

export const SAMTOOLS_ID = 'samtools';
export const BWA_ID = 'bwa';
export const MINIMAP2_ID = 'minimap2';
export const BCFTOOLS_ID = 'bcftools';
export const FASTP_ID = 'fastp';
export const SEQKIT_ID = 'seqkit';
export const SNPEFF_ID = 'snpeff';

// ── Built-in Native Tools Registry ───────────────────────────────────────────

export const BUILT_IN_NATIVE_TOOLS: LiatirNativeToolMetadata[] = [
  {
    id: SAMTOOLS_ID,
    name: 'samtools',
    displayName: 'Samtools',
    description: 'SAM/BAM/CRAM processing toolkit for viewing, sorting, filtering, and converting alignment files.',
    category: 'Alignment',
    binaryName: 'samtools',
    tags: ['built-in', 'alignment', 'bam', 'sam', 'cram', 'indexing']
  },
  {
    id: BWA_ID,
    name: 'bwa',
    displayName: 'BWA',
    description: 'Burrows-Wheeler Aligner for short-read alignment against a reference genome.',
    category: 'Alignment',
    binaryName: 'bwa',
    tags: ['built-in', 'alignment', 'short-read', 'mapping']
  },
  {
    id: MINIMAP2_ID,
    name: 'minimap2',
    displayName: 'Minimap2',
    description: 'Versatile pairwise aligner for long-read and short-read sequences.',
    category: 'Alignment',
    binaryName: 'minimap2',
    tags: ['built-in', 'alignment', 'long-read', 'short-read', 'mapping']
  },
  {
    id: BCFTOOLS_ID,
    name: 'bcftools',
    displayName: 'BCFtools',
    description: 'Utilities for variant calling and manipulating VCF/BCF files.',
    category: 'Variant Calling',
    binaryName: 'bcftools',
    tags: ['built-in', 'variant-calling', 'vcf', 'bcf', 'filtering']
  },
  {
    id: FASTP_ID,
    name: 'fastp',
    displayName: 'fastp',
    description: 'Ultra-fast all-in-one FASTQ preprocessor for quality control and filtering.',
    category: 'Quality Control',
    binaryName: 'fastp',
    tags: ['built-in', 'qc', 'fastq', 'trimming', 'filtering']
  },
  {
    id: SEQKIT_ID,
    name: 'seqkit',
    displayName: 'SeqKit',
    description: 'Cross-platform and ultrafast toolkit for FASTA/Q file manipulation.',
    category: 'Sequence Processing',
    binaryName: 'seqkit',
    tags: ['built-in', 'fasta', 'fastq', 'sequence', 'statistics']
  },
  {
    id: SNPEFF_ID,
    name: 'snpeff',
    displayName: 'SnpEff',
    description: 'Genetic variant annotation and functional effect prediction toolbox.',
    category: 'Variant Annotation',
    binaryName: 'snpeff',
    tags: ['built-in', 'annotation', 'variant-effect', 'snv', 'indel']
  }
];

// ── Helper functions ─────────────────────────────────────────────────────────

/**
 * Get native tool metadata by ID.
 */
export function getNativeToolMetadata(id: string): LiatirNativeToolMetadata | undefined {
  return BUILT_IN_NATIVE_TOOLS.find(t => t.id === id);
}

/**
 * Get all native tool IDs.
 */
export function getNativeToolIds(): string[] {
  return BUILT_IN_NATIVE_TOOLS.map(t => t.id);
}

/**
 * Check if a tool ID is a known bundled native tool.
 */
export function isBundledNativeTool(id: string): boolean {
  return BUILT_IN_NATIVE_TOOLS.some(t => t.id === id);
}

// ── Bundled Native Tools environment ─────────────────────────────────────────
//
// The process-backed tools ship inside the application as one relocatable conda
// prefix, built from `native-tools-env/pixi.toml` by
// `scripts/build-native-tools-env.mjs`. The user installs nothing.
//
// FastQC is absent because it runs as WASM in-process, and SnpEff because it is
// a Java runtime whose JRE would outweigh every tool here combined.

/** Conda subdirs Liatir builds a Native Tools environment for. */
export type LiatirNativeToolsSubdir = 'osx-arm64' | 'linux-64';

/** Tool IDs provided by the bundled environment, in build order. */
export const BUNDLED_ENVIRONMENT_TOOL_IDS: readonly string[] = [
  SAMTOOLS_ID,
  BCFTOOLS_ID,
  SEQKIT_ID,
  FASTP_ID,
  BWA_ID,
  MINIMAP2_ID,
];

/** File name of the manifest written beside the environment it describes. */
export const NATIVE_TOOLS_MANIFEST_FILE = 'liatir-native-tools.json';

/** What the build recorded about the environment that shipped. */
export interface LiatirNativeToolsManifest {
  schemaVersion: 1;
  subdir: LiatirNativeToolsSubdir;
  /** SHA-256 of `pixi.lock` — the identity of this exact set of tool builds. */
  lockDigest: string;
  builtAt: string;
  tools: { id: string; version: string }[];
}

/**
 * How a host runs the bundled environment.
 *
 * `native` executes the prefix in place. `wsl2` is Windows: bioconda publishes
 * no `win-64` builds and five of these six tools have no Windows build anywhere,
 * so Windows ships the `linux-64` environment and runs it through WSL2 — the
 * same backend External Workflows already requires for Nextflow.
 */
export interface LiatirNativeToolsPlacement {
  subdir: LiatirNativeToolsSubdir;
  execution: 'native' | 'wsl2';
}

export function nativeToolsPlacement(
  os: 'macos' | 'linux' | 'windows',
  arch: 'x86_64' | 'arm64',
): LiatirNativeToolsPlacement | null {
  if (os === 'macos' && arch === 'arm64') return { subdir: 'osx-arm64', execution: 'native' };
  if (os === 'linux' && arch === 'x86_64') return { subdir: 'linux-64', execution: 'native' };
  if (os === 'windows' && arch === 'x86_64') return { subdir: 'linux-64', execution: 'wsl2' };
  return null;
}

/** True when this host gets `id` from the bundle instead of from the user's machine. */
export function isProvidedByBundledEnvironment(
  id: string,
  os: 'macos' | 'linux' | 'windows',
  arch: 'x86_64' | 'arm64',
): boolean {
  return nativeToolsPlacement(os, arch) !== null && BUNDLED_ENVIRONMENT_TOOL_IDS.includes(id);
}