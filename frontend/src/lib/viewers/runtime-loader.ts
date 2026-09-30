/**
 * Reads installed viewer runtimes for the sandboxed viewers.
 *
 * These libraries are UMD bundles that attach themselves to `window`. They never run in the app's own
 * document: each viewer inlines the source into the document its sandbox frame runs.
 */
import { liatir } from '$lib/api';
import { viewerRuntimesStore } from '$lib/stores/viewerRuntimes.svelte';
import type { ViewerRuntimeRecord } from './runtime-registry';

/**
 * Reads a runtime's source as *text*, rather than loading it into the page.
 *
 * Used where the library must run somewhere other than the main document — inside a sandboxed iframe,
 * for instance — and therefore needs its source rather than a script tag in this document.
 */
export async function readViewerRuntimeScript(runtimeId: string): Promise<{ runtime: ViewerRuntimeRecord; source: string }> {
  await viewerRuntimesStore.init();
  const runtime = viewerRuntimesStore.byId(runtimeId);
  if (!runtime) throw new Error(`Unknown viewer runtime: ${runtimeId}`);
  if (runtime.status !== 'installed' || !runtime.entryPath) {
    throw new Error(`${runtime.name} is not installed.`);
  }
  const api = liatir();
  if (!api) throw new Error('Liatir API not available.');
  // The store verifies the entry file at init, but the runtime can disappear between that check and
  // this read. Reporting it as not installed keeps the user on the one action that fixes it —
  // reinstalling — instead of showing them the filesystem error underneath.
  let source: string;
  try {
    source = await api.invoke('lia_read_file_text', { path: runtime.entryPath }) as string;
  } catch {
    throw new Error(`${runtime.name} is not installed.`);
  }
  return { runtime, source };
}
