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
  try {
    await liatir()?.openBrowser(link);
  } catch (error) {
    console.error(error);
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
