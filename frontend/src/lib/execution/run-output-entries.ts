export interface ListedFsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number | null;
}

export interface RunOutputEntry {
  name: string;
  path: string;
  size?: number;
}

/** Keeps directories out of the file-artifact list returned by the native bridge. */
export function fileRunOutputEntries(entries: ListedFsEntry[]): RunOutputEntry[] {
  return entries
    .filter((entry) => !entry.is_dir)
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      ...(entry.size != null ? { size: entry.size } : {}),
    }));
}
