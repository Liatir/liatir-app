/** Parse a version string like "1.17", "21.0.1", "0.23.4" into comparable parts. */
export function parseVersion(v: string): number[] {
  return v
    .replace(/^[^0-9]*/, '')   // strip leading non-numeric (e.g. "v1.2" → "1.2")
    .split(/[-+]/)[0]           // strip build metadata
    .split('.')
    .map(n => parseInt(n, 10) || 0);
}

/** Returns true if `installed` >= `required`. */
export function versionGte(installed: string, required: string): boolean {
  const a = parseVersion(installed);
  const b = parseVersion(required);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return true;
}
