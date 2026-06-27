const MULTIPART_EXTENSIONS = ['fastq.gz', 'fq.gz', 'fasta.gz', 'fa.gz', 'vcf.gz', 'bcf.gz'] as const;

export function normalizeExtension(extension: string): string {
  return extension.trim().toLowerCase().replace(/^\./, '');
}

export function detectFileExtension(pathOrName: string): string {
  const lower = pathOrName.toLowerCase();
  for (const extension of MULTIPART_EXTENSIONS) {
    if (lower.endsWith(`.${extension}`)) return extension;
  }

  const fileName = lower.split(/[\\/]/).pop() ?? lower;
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1) : '';
}

export function matchesAcceptedExtension(pathOrName: string, acceptedExtensions: string[]): boolean {
  if (acceptedExtensions.length === 0) return true;

  const normalizedPath = pathOrName.toLowerCase();
  const detected = detectFileExtension(pathOrName);
  return acceptedExtensions.some((extension) => {
    const normalized = normalizeExtension(extension);
    return detected === normalized || normalizedPath.endsWith(`.${normalized}`);
  });
}
