import { liatir } from '$lib/api';
import { viewerRuntimesStore } from '$lib/stores/viewerRuntimes.svelte';
import type { ViewerRuntimeRecord } from './runtime-registry';

const loadedScripts = new Map<string, Promise<void>>();

declare global {
  interface Window {
    $3Dmol?: unknown;
    JBrowseReactLinearGenomeView?: unknown;
  }
}

export function localFileSrc(path: string): string {
  const api = liatir();
  const convert = api?.tauri?.core?.convertFileSrc;
  return typeof convert === 'function' ? convert(path) : path;
}

export async function getViewerRuntimeScriptUrl(runtimeId: string): Promise<{ runtime: ViewerRuntimeRecord; url: string }> {
  await viewerRuntimesStore.init();
  const runtime = viewerRuntimesStore.byId(runtimeId);
  if (!runtime) throw new Error(`Unknown viewer runtime: ${runtimeId}`);
  if (runtime.status !== 'installed' || !runtime.entryPath) {
    throw new Error(`${runtime.name} is not installed.`);
  }
  return { runtime, url: localFileSrc(runtime.entryPath) };
}

export async function loadViewerRuntimeScript(runtimeId: string): Promise<void> {
  const { runtime, url } = await getViewerRuntimeScriptUrl(runtimeId);

  const existing = loadedScripts.get(runtimeId);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${runtime.name}.`));
    document.head.appendChild(script);
  });
  loadedScripts.set(runtimeId, promise);
  return promise;
}
