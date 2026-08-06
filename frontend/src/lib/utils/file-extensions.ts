/**
 * File-extension handling, with the compound extensions bioinformatics actually uses.
 *
 * The whole reason this file exists: naive extension detection on `reads.fastq.gz` returns `gz`,
 * which says the file is compressed but not *what it is*. Liatir has to know it is a FASTQ, because
 * that is what decides which tools accept it. So the known compound suffixes are matched first, and
 * only then does it fall back to "everything after the last dot".
 */
const MULTIPART_EXTENSIONS = ['fastq.gz', 'fq.gz', 'fasta.gz', 'fa.gz', 'vcf.gz', 'bcf.gz'] as const;

/** Lowercased, trimmed, and without a leading dot — so `.FASTQ`, `fastq` and `.fastq` all compare equal. */
export function normalizeExtension(extension: string): string {
  return extension.trim().toLowerCase().replace(/^\./, '');
}

/** Compound extensions win over the last-dot rule — see the note above. Returns `''` if there is none. */
export function detectFileExtension(pathOrName: string): string {
  const lower = pathOrName.toLowerCase();
  for (const extension of MULTIPART_EXTENSIONS) {
    if (lower.endsWith(`.${extension}`)) return extension;
  }

  // Only the last path segment: a dot in a *directory* name must not be mistaken for an extension.
  const fileName = lower.split(/[\\/]/).pop() ?? lower;
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1) : '';
}

/**
 * Whether a file is acceptable to a tool. An empty accept list means the tool takes anything.
 *
 * Two ways to match, and the second matters: the detected extension may be the compound `fastq.gz`
 * while a tool declares plain `gz` (or vice versa), so the raw path suffix is also checked. Either
 * agreeing is enough — being strict here would reject files that tools can genuinely read.
 */
export function matchesAcceptedExtension(pathOrName: string, acceptedExtensions: string[]): boolean {
  if (acceptedExtensions.length === 0) return true;

  const normalizedPath = pathOrName.toLowerCase();
  const detected = detectFileExtension(pathOrName);
  return acceptedExtensions.some((extension) => {
    const normalized = normalizeExtension(extension);
    return detected === normalized || normalizedPath.endsWith(`.${normalized}`);
  });
}
