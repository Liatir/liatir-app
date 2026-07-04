import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

/**
 * Reads the `version` field of a package.json file, returning undefined on
 * any read/parse failure so callers can decide how to degrade.
 */
async function readPackageVersion(packageJsonPath: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Version of the running CLI, read from this package's own package.json.
 * The compiled file lives at dist/commands/version.js, so the package root
 * is two directories up from this module.
 */
async function cliVersion(): Promise<string | undefined> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return readPackageVersion(path.resolve(moduleDir, "..", "..", "package.json"));
}

/**
 * Version of @liatir/api as resolved from the current working directory,
 * using Node's own module resolution (walks parent node_modules, so it works
 * from any subdirectory of a plugin project and inside monorepos).
 * Returns undefined when the package is not installed — e.g. outside a
 * project, or in WASM/Python .lia projects that don't use @liatir/api.
 */
async function apiVersion(): Promise<string | undefined> {
  try {
    // createRequire needs a file path as resolution base; the file itself
    // does not have to exist, it only anchors the node_modules lookup.
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const apiPackageJsonPath = require.resolve("@liatir/api/package.json");
    return readPackageVersion(apiPackageJsonPath);
  } catch {
    return undefined;
  }
}

/**
 * `liatir -v` / `liatir --version` / `liatir version` — prints the CLI
 * version and, when installed in the current project, the @liatir/api version.
 */
export async function version(): Promise<void> {
  const [cli, api] = await Promise.all([cliVersion(), apiVersion()]);

  console.log(`@liatir/cli v${cli ?? "unknown"}`);
  if (api !== undefined) {
    console.log(`@liatir/api v${api}`);
  }
}
