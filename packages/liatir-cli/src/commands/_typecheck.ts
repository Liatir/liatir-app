/**
 * Type-checks a plugin project before it is run or packaged.
 *
 * Catching a type error here means the author sees it in their terminal, instead of it surfacing
 * as a runtime failure inside Liatir where the context is much harder to read.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import { formatProcessError } from "./_process.js";

const execFileAsync = promisify(execFile);

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Runs `tsc --noEmit` if — and only if — the project looks like a TypeScript one.
 *
 * A missing tsconfig.json simply means a plain JavaScript plugin, so this is a no-op rather than
 * an error. But a tsconfig *with* no local TypeScript installed is a broken setup, and is
 * reported with the fix, because silently skipping the check there would let type errors ship.
 */
export async function typecheckIfConfigured(cwd: string, label: string): Promise<void> {
  const tsconfigPath = path.join(cwd, "tsconfig.json");
  if (!(await exists(tsconfigPath))) return;

  // The plugin's *own* TypeScript is used, never the CLI's: the author's code must be checked
  // against the compiler version their project pins.
  const localTsc = path.join(cwd, "node_modules", "typescript", "bin", "tsc");
  if (!(await exists(localTsc))) {
    throw new Error(
      `[${label}] TypeScript project detected, but local TypeScript is missing.\n` +
      "Run `npm install` in the plugin directory, then try again."
    );
  }

  try {
    // Invoked through the current Node binary rather than relying on the shebang or a PATH lookup,
    // which makes it work the same way regardless of how the CLI itself was installed.
    await execFileAsync(process.execPath, [localTsc, "-p", tsconfigPath, "--noEmit"], { cwd });
  } catch (err) {
    // A non-zero exit from tsc is a type error: surface the compiler's own output, since that is
    // what tells the author which line to fix.
    throw new Error(`[${label}] TypeScript check failed:\n${formatProcessError(err)}`);
  }
}
