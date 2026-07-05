import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import { formatProcessError } from "./_process.js";

const execFileAsync = promisify(execFile);

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

export async function typecheckIfConfigured(cwd: string, label: string): Promise<void> {
  const tsconfigPath = path.join(cwd, "tsconfig.json");
  if (!(await exists(tsconfigPath))) return;

  const localTsc = path.join(cwd, "node_modules", "typescript", "bin", "tsc");
  if (!(await exists(localTsc))) {
    throw new Error(
      `[${label}] TypeScript project detected, but local TypeScript is missing.\n` +
      "Run `npm install` in the plugin directory, then try again."
    );
  }

  try {
    await execFileAsync(process.execPath, [localTsc, "-p", tsconfigPath, "--noEmit"], { cwd });
  } catch (err) {
    throw new Error(`[${label}] TypeScript check failed:\n${formatProcessError(err)}`);
  }
}
