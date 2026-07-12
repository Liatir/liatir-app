/**
 * Small shared UI helpers: formatting, class names, and — the substantial part of this file —
 * shortening absolute filesystem paths before they are shown to the user.
 */
import { liatir } from "./api";

/**
 * Human-readable elapsed time. The unit changes with the magnitude, because "125300ms" tells a
 * user nothing that "2m 5s" does not tell them better. Defaults to "until now", so it can be
 * called on a job that is still running.
 */
export function fmtDuration(startMs: number, endMs?: number): string {
  const ms = (endMs ?? Date.now()) - startMs;
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** Human-readable size, scaling the unit to the value. Binary units (1024), as used for files. */
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


/**
 * Opens a link in the user's real browser, not inside the app's webview.
 *
 * Navigating the webview away from the app would effectively replace Liatir with a web page, with
 * no way back. The desktop bridge is tried first; the `window.open` fallback exists for when the
 * app runs in a plain browser during development.
 */
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
    // noopener,noreferrer: the opened page must not get a handle back to this window.
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

/** Last N path segments, e.g. `/Users/x/data/reads/sample.fastq` -> `reads/sample.fastq`. */
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

// --- Local path shortening -------------------------------------------------------------------
//
// Tool output, error messages and logs are full of absolute paths like
// `/Users/lorenzo/Documents/data/run3/sample.fastq`. Shown verbatim they wreck the layout, bury the
// part the user cares about (the filename), and put the user's real name and directory structure on
// screen — which matters as soon as they screenshot a result or share it with a colleague.
//
// So paths are collapsed to their last couple of segments for display only. The originals are
// untouched: this is a presentation concern, and nothing here feeds back into any real filesystem
// operation.

/** Anchored: does the value *start* as an absolute local path? Used to test a whole string. */
const LOCAL_PATH_START_RE = /^(?:[A-Za-z]:[\\/]|\/(?:Users|Volumes|private|tmp|var|home|opt|usr|Applications|Library)\b)/;
/** Unanchored: does the text *contain* a path anywhere? Used as a cheap pre-check before rewriting. */
const LOCAL_PATH_ANY_RE = /(?:[A-Za-z]:[\\/]|\/(?:Users|Volumes|private|tmp|var|home|opt|usr|Applications|Library)\b)/;
/**
 * File extensions that mark the end of a path inside prose. Needed because a path embedded in a
 * sentence has no delimiter — this is what tells us where it stops. Mostly bioinformatics formats,
 * since that is what appears in this app's output.
 */
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

/**
 * Shortens every absolute path found *inside* a block of text (a log line, an error message).
 *
 * Harder than shortening a bare path, because a path buried in prose has no obvious end. Three
 * passes, each recognising a different way a path terminates:
 *
 *   1. quoted   — `"…/sample.fastq"`: the closing quote is the boundary;
 *   2. by extension — the path ends at a known file suffix followed by whitespace or punctuation;
 *   3. by binary name — `…/venv/bin/python`, `…/uv`: executables have no extension, so the known
 *      command names are what mark the end.
 *
 * The early return is a fast path: most text contains no paths at all, and three regex passes over
 * every log line would be wasted work.
 */
export function sanitizeLocalPathsForDisplay(text: string, nSegments = 2): string {
  if (!text || !LOCAL_PATH_ANY_RE.test(text)) {
    return text;
  }

  // 1. Quoted paths — the quotes are preserved, only what is between them shrinks.
  let sanitized = text.replace(
    /(["'`])((?:[A-Za-z]:[\\/]|\/(?:Users|Volumes|private|tmp|var|home|opt|usr|Applications|Library)\b)[^"'`\r\n<>]*?)\1/g,
    (_match, quote: string, path: string) => `${quote}${compactPathForDisplay(path, nSegments)}${quote}`,
  );

  // 2. Paths ending in a known file extension. Built dynamically from LOCAL_PATH_EXTENSIONS, and
  // the lookahead requires a real boundary after it so `sample.fastq.gz` is not cut at `.fastq`.
  sanitized = sanitized.replace(
    new RegExp(`((?:[A-Za-z]:[\\\\/]|/(?:Users|Volumes|private|tmp|var|home|opt|usr|Applications|Library)\\b)[^\\r\\n\\t"'<>]*?\\.(?:${LOCAL_PATH_EXTENSIONS})(?=$|[\\s,;:)\\]]))`, 'gi'),
    (path: string) => compactPathForDisplay(path, nSegments),
  );

  // 3. Paths ending in an interpreter or tool name. These carry no extension, and they are exactly
  // what fills the long "command not found" and traceback lines this app surfaces.
  sanitized = sanitized.replace(
    /((?:[A-Za-z]:[\\/]|\/(?:Users|Volumes|private|tmp|var|home|opt|usr|Applications|Library)\b)[^\r\n"'<>]*?\/(?:python(?:\d(?:\.\d+)?)?|python3(?:\.\d+)?|pip|pip3|node|npm|uv|boltz|chai-lab)(?=$|[\s,;:)\]]))/g,
    (path: string) => compactPathForDisplay(path, nSegments),
  );

  return sanitized;
}

/**
 * Applies the path shortening across a whole value — walking into arrays and objects — so a nested
 * tool result can be sanitised in one call rather than field by field at every call site.
 * Non-string leaves are returned untouched.
 */
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
