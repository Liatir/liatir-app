import { getDataPrefix } from '$lib/stores/workspace.svelte';

// Run UUIDs are app-wide. Keep their captured destination across navigation;
// persisted historical runs resolve from the workspace in which they are opened.
const owners = new Map<string, string>();

export function rememberRunWorkspace(runId: string, workspaceId: string | null): void {
  const prefix = workspaceId ? `workspaces/${workspaceId}/` : '';
  const previous = owners.get(runId);
  if (previous !== undefined && previous !== prefix) throw new Error('Run workspace identity collision.');
  owners.set(runId, prefix);
}

export function runWorkspacePrefix(runId: string): string {
  return owners.get(runId) ?? getDataPrefix();
}
