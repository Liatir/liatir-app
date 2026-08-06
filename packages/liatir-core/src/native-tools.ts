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