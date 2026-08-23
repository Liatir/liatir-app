/**
 * Naming for the Data library's `Results/<Tool>` folders.
 *
 * These are **virtual** folders: the library indexes absolute paths and groups them under a label,
 * so where a file physically lives is unrelated to where the user finds it. Files themselves live in
 * the run that produced them — see `$lib/execution/run-storage`.
 */

/** Sanitize a tool/request name into a folder-safe segment. */
export function safeResultName(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'tool';
}
