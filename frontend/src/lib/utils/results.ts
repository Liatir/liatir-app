import { liatir } from '$lib/api';
import { getDataPrefix } from '$lib/stores/workspace.svelte';

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
