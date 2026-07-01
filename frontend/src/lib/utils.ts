import { liatir } from "./api";

export function fmtDuration(startMs: number, endMs?: number): string {
  const ms = (endMs ?? Date.now()) - startMs;
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function clsx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export async function md5(string: string) {
  const msgUint8 = new TextEncoder().encode(string);                                  // encode as (utf-8) bytes
  const hashBuffer = await crypto.subtle.digest('MD5', msgUint8);                     // hash the message
  const hashArray = Array.from(new Uint8Array(hashBuffer));                           // convert buffer to byte array
  const hashedString = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');  // convert bytes to hex string

  try {
    return hashedString.normalize().trim();
  } catch (error) {
    return hashedString.trim();
  }
}


export const openLinkInBrowser = async (link: string) => {
  const href = link.trim();
  if (!href) return;

  try {
    const api = liatir();
    if (api?.openBrowser) {
      await api.openBrowser(href);
      return;
    }
  } catch (error) {
    console.error(error);
  }

  if (typeof window !== 'undefined') {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

export const getLastSegmentsStringFromPath = (path: string, nSegments?: number): string => {
  try {
    const queryRemoved: string = path.includes("?") ? path.trim().split("?")[0] : path.trim();
    const segments: string[] = queryRemoved.split(/[\\/]/).filter(Boolean);

    let n: number = 1;
    if (nSegments && nSegments >= 1) n = Math.round(nSegments);

    return segments.slice(-n).join("/");
  } catch (error) {
    console.error(error);
    return "";
  }
}

const LOCAL_PATH_START_RE = /^(?:[A-Za-z]:[\\/]|\/(?:Users|Volumes|private|tmp|var|home|opt|usr|Applications|Library)\b)/;
const LOCAL_PATH_ANY_RE = /(?:[A-Za-z]:[\\/]|\/(?:Users|Volumes|private|tmp|var|home|opt|usr|Applications|Library)\b)/;
const LOCAL_PATH_EXTENSIONS = [
  'bcf',
  'bed',
  'bin',
  'cif',
  'cram',
  'csv',
  'faa',
  'fa',
  'fai',
  'fasta',
  'fastq',
  'fna',
  'fq',
  'gff',
  'gff3',
  'gtf',
  'gz',
  'h5ad',
  'html',
  'json',
  'log',
  'mmcif',
  'mol2',
  'npy',
  'npz',
  'parquet',
  'pdb',
  'pkl',
  'pt',
  'py',
  'sam',
  'sdf',
  'tsv',
  'txt',
  'vcf',
  'xyz',
  'yaml',
  'yml',
].join('|');

export function isLikelyLocalPath(value: string): boolean {
  return LOCAL_PATH_START_RE.test(value.trim());
}

export function compactPathForDisplay(path: string, nSegments = 2): string {
  const compact = getLastSegmentsStringFromPath(path, nSegments);
  return compact || path;
}

export function compactPathIfLocal(value: string, nSegments = 2): string {
  return isLikelyLocalPath(value) ? compactPathForDisplay(value, nSegments) : value;
}

export function sanitizeLocalPathsForDisplay(text: string, nSegments = 2): string {
  if (!text || !LOCAL_PATH_ANY_RE.test(text)) {
    return text;
  }

  let sanitized = text.replace(
    /(["'`])((?:[A-Za-z]:[\\/]|\/(?:Users|Volumes|private|tmp|var|home|opt|usr|Applications|Library)\b)[^"'`\r\n<>]*?)\1/g,
    (_match, quote: string, path: string) => `${quote}${compactPathForDisplay(path, nSegments)}${quote}`,
  );

  sanitized = sanitized.replace(
    new RegExp(`((?:[A-Za-z]:[\\\\/]|/(?:Users|Volumes|private|tmp|var|home|opt|usr|Applications|Library)\\b)[^\\r\\n\\t"'<>]*?\\.(?:${LOCAL_PATH_EXTENSIONS})(?=$|[\\s,;:)\\]]))`, 'gi'),
    (path: string) => compactPathForDisplay(path, nSegments),
  );

  sanitized = sanitized.replace(
    /((?:[A-Za-z]:[\\/]|\/(?:Users|Volumes|private|tmp|var|home|opt|usr|Applications|Library)\b)[^\r\n"'<>]*?\/(?:python(?:\d(?:\.\d+)?)?|python3(?:\.\d+)?|pip|pip3|node|npm|uv|boltz|chai-lab)(?=$|[\s,;:)\]]))/g,
    (path: string) => compactPathForDisplay(path, nSegments),
  );

  return sanitized;
}

export function sanitizeForDisplay(value: unknown, nSegments = 2): unknown {
  if (typeof value === 'string') return sanitizeLocalPathsForDisplay(compactPathIfLocal(value, nSegments), nSegments);
  if (Array.isArray(value)) return value.map((item) => sanitizeForDisplay(item, nSegments));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeForDisplay(item, nSegments)]),
    );
  }
  return value;
}
