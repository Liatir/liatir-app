import * as fs from "fs/promises";
import { fileURLToPath } from "url";

// Present in the first line of every CLI-managed SDK file; syncManagedSdkFile
// refuses to overwrite files without it, so a user's own module named
// liatir.py/liatir.rs is never clobbered.
const MANAGED_HEADER = "managed by @liatir/cli";

/**
 * CLI-shipped assets (the Liatir plugin SDK files and contract extractors).
 * They live in src/assets during development and are copied to dist/assets on
 * package build, so resolving relative to this module works in both layouts.
 */
export function assetPath(name: string): string {
  return fileURLToPath(new URL(`../assets/${name}`, import.meta.url));
}

export function assetsDir(): string {
  return fileURLToPath(new URL("../assets/", import.meta.url));
}

// Assets are immutable for the life of the process; read each at most once
// (liatir dev rebuilds call this on every file change).
const assetCache = new Map<string, Promise<string>>();

export function readAsset(name: string): Promise<string> {
  let cached = assetCache.get(name);
  if (!cached) {
    cached = fs.readFile(assetPath(name), "utf-8");
    assetCache.set(name, cached);
  }
  return cached;
}

/**
 * Keep a CLI-managed SDK file (liatir.py / liatir.rs) inside a plugin project
 * in sync with this CLI version. Refuses to touch a file that does not carry
 * the managed header (it belongs to the user, not to the CLI). Returns true
 * when the file was created or updated.
 */
export async function syncManagedSdkFile(targetPath: string, assetName: string): Promise<boolean> {
  const content = await readAsset(assetName);
  const existing = await fs.readFile(targetPath, "utf-8").catch(() => null);
  if (existing === content) return false;
  if (existing !== null && !existing.includes(MANAGED_HEADER)) {
    throw new Error(
      `${targetPath} is not the CLI-managed Liatir SDK file (missing the "${MANAGED_HEADER}" header). ` +
      `Rename your module: this path is reserved for the Liatir plugin SDK.`,
    );
  }
  await fs.writeFile(targetPath, content);
  return true;
}
