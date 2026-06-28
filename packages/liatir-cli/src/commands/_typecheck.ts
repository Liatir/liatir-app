import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

function formatProcessError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as { stdout?: unknown; stderr?: unknown; message?: unknown };
  const stdout = typeof e.stdout === "string" ? e.stdout.trim() : "";
  const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
  return [stdout, stderr, typeof e.message === "string" ? e.message : ""]
    .filter(Boolean)
    .join("\n");
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
