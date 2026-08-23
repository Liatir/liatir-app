import { liatir } from '$lib/api';
import { getDataPrefix } from '$lib/stores/workspace.svelte';

const TOOL_OUTPUTS_DIR = 'tool-outputs';

/** Sanitize a tool/request name into a folder-safe segment. */
export function safeResultName(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'tool';
}

/**
 * Ensure the workspace-scoped `Results/<tool>` directory exists on disk and
 * return both its absolute path (for native tools that write files directly)
 * and the virtual folder label used by the dataFiles store.
 *
 * The directory is created in the *data* scope (permanent: true) under the
 * active workspace prefix, so outputs are isolated per workspace and removed
 * when the workspace is deleted.
 */
export async function ensureResultsDir(
  toolName: string
): Promise<{ absDir: string; virtualFolder: string; safe: string }> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');

  const safe = safeResultName(toolName);
  const prefix = getDataPrefix();              // 'workspaces/{id}/' or ''
  const relResults = `${prefix}Results`;
  const relTool = `${relResults}/${safe}`;

  // permanent: true → data scope (NOT cache). Both levels created.
  await api.invoke('lia_fs_mkdir', { rel: relResults, permanent: true });
  await api.invoke('lia_fs_mkdir', { rel: relTool, permanent: true });

  const { data } = await api.invoke('lia_fs_paths') as { data: string; cache: string };
  return { absDir: `${data}/${relTool}`, virtualFolder: `Results/${safe}`, safe };
}

/** Where one run's files live, relative to the data directory. */
function runOutputsRel(runId: string): string {
  return `${TOOL_OUTPUTS_DIR}/${runId}`;
}

/**
 * Ensure this run's own output directory exists and return its absolute path.
 *
 * A directory per run is what turns "the tool says it left nothing behind" into something Liatir
 * can check: at finalization it lists this directory and records whatever is in it, so a file the
 * tool wrote and forgot to declare is recorded anyway. Tools used to write into one shared folder
 * under run-prefixed filenames, which kept them apart but left nothing to enumerate.
 *
 * Files a tool must write elsewhere — an index that has to sit beside the user's reference for the
 * tool to find it — cannot be discovered this way and still have to be declared.
 */
export async function ensureRunOutputsDir(runId: string): Promise<string> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');

  await api.invoke('lia_fs_mkdir', { rel: TOOL_OUTPUTS_DIR, permanent: true });
  await api.invoke('lia_fs_mkdir', { rel: runOutputsRel(runId), permanent: true });
  const { data } = await api.invoke('lia_fs_paths') as { data: string; cache: string };
  return `${data}/${runOutputsRel(runId)}`;
}

export interface RunOutputEntry {
  name: string;
  path: string;
  size?: number;
}

/**
 * Everything actually sitting in a run's output directory.
 *
 * Returns nothing when the directory was never created — most runs write no files at all, and a run
 * that produced nothing is not an error to report.
 */
export async function listRunOutputs(runId: string): Promise<RunOutputEntry[]> {
  const api = liatir();
  if (!api) return [];
  try {
    const entries = await api.invoke('lia_fs_list_dir', {
      rel: runOutputsRel(runId),
      permanent: true,
      windowLabel: undefined,
      pluginStoragePlugin: undefined,
    }) as Array<{ name: string; path: string; isDir: boolean; size?: number | null }>;
    return entries
      .filter((entry) => !entry.isDir)
      .map((entry) => ({
        name: entry.name,
        path: entry.path,
        ...(entry.size != null ? { size: entry.size } : {}),
      }));
  } catch {
    // The directory does not exist, which is the normal case for a run that writes nothing.
    return [];
  }
}
