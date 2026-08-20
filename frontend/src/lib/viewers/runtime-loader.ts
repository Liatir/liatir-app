/**
 * Loads an installed viewer runtime into the page.
 *
 * These libraries are UMD bundles that attach themselves to `window`, so they cannot be `import`ed —
 * they have to be injected as a `<script>` tag and then read off the global object. The globals they
 * define are declared below so the rest of the code can reach them type-safely.
 */
import { liatir } from '$lib/api';
import { viewerRuntimesStore } from '$lib/stores/viewerRuntimes.svelte';
import type { ViewerRuntimeRecord } from './runtime-registry';

/**
 * Scripts already injected, keyed by runtime ID.
 *
 * A script tag can only be added once — appending it twice would re-execute a multi-megabyte library
 * and clobber its own globals. Caching the *promise* (not a boolean) also means several components
 * mounting at the same moment all await the same load instead of racing to inject duplicates.
 */
const loadedScripts = new Map<string, Promise<void>>();

// The globals these UMD bundles define when they execute.
declare global {
  interface Window {
    $3Dmol?: unknown;
    JBrowseReactLinearGenomeView?: unknown;
  }
}

/**
 * Turns an absolute filesystem path into a URL the webview is allowed to fetch.
 *
 * The webview cannot load `file://` paths directly — Tauri exposes them through its own asset
 * protocol, and `convertFileSrc` performs that mapping. The fallback returns the path unchanged, for
 * when the app is running in a plain browser during development.
 */
export function localFileSrc(path: string): string {
  const api = liatir();
  const convert = api?.tauri?.core?.convertFileSrc;
  return typeof convert === 'function' ? convert(path) : path;
}

/**
 * Resolves an installed runtime to a URL the webview can load. Throws if it is not installed — the
 * caller is expected to have offered the install first.
 */
export async function getViewerRuntimeScriptUrl(runtimeId: string): Promise<{ runtime: ViewerRuntimeRecord; url: string }> {
  await viewerRuntimesStore.init();
  const runtime = viewerRuntimesStore.byId(runtimeId);
  if (!runtime) throw new Error(`Unknown viewer runtime: ${runtimeId}`);
  if (runtime.status !== 'installed' || !runtime.entryPath) {
    throw new Error(`${runtime.name} is not installed.`);
  }
  return { runtime, url: localFileSrc(runtime.entryPath) };
}

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

/**
 * Injects a runtime's script into the document, exactly once.
 *
 * The script tag is never removed: these libraries register globals and cannot be meaningfully
 * unloaded, so once a viewer has been opened its runtime stays resident for the session.
 */
export async function loadViewerRuntimeScript(runtimeId: string): Promise<void> {
  const { runtime, url } = await getViewerRuntimeScriptUrl(runtimeId);

  // Already loading or loaded — return the same promise rather than injecting a second tag.
  const existing = loadedScripts.get(runtimeId);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    // The runtime's *name* is used, not the URL: the user needs to know which viewer failed, not
    // where its bundle happened to live on disk.
    script.onerror = () => reject(new Error(`Failed to load ${runtime.name}.`));
    document.head.appendChild(script);
  });
  loadedScripts.set(runtimeId, promise);
  return promise;
}
