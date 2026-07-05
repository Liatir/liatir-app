/**
 * Render a failed child-process error (execFile/spawn) as readable text:
 * captured stdout + stderr first, then the error message. Shared by every
 * command that shells out — keep this the only copy.
 */
export function formatProcessError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as { stdout?: unknown; stderr?: unknown; message?: unknown };
  const stdout = typeof e.stdout === "string" ? e.stdout.trim() : "";
  const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
  return [stdout, stderr, typeof e.message === "string" ? e.message : ""]
    .filter(Boolean)
    .join("\n") || String(err);
}
