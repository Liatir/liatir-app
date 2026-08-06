export * from "./core/_helpers";
export * from "./liatir/_helpers";
export * from "./modules/rs/files/_helpers";
export * from "./modules/rs/events/_helpers";
export * from "./modules/rs/fs/_helpers";
export * from "./modules/rs/clipboard/_helpers";
export * from "./modules/rs/shortcuts/_helpers";
export * from "./modules/rs/notifications/_helpers";
export * from "./modules/rs/app/_helpers";
export * from "./modules/rs/window/_helpers";
export * from "./modules/rs/dragdrop/_helpers";
export * from "./modules/rs/menu/_helpers";
export * from "./modules/rs/diagnostics/_helpers";
export * from "./modules/rs/network/_helpers";
export * from "./modules/rs/autostart/_helpers";
export * from "./modules/rs/badge/_helpers";
export * from "./modules/rs/worker/_helpers";
export * from "./modules/rs/contextMenu/_helpers";
export * from "./modules/rs/globalVariables/_helpers";


import { wait } from "./utils";

// Ready when the Tauri core is present AND the bridge has assigned window.Liatir.
// Use __TAURI_INTERNALS__ (always injected by Tauri v2) OR the __TAURI__ global
// (only present with withGlobalTauri) — aligned with isTauri() below. Checking
// only __TAURI__ made programmatically-created webviews (e.g. the plugin dev
// window) time out with "Tauri did not become ready in time".
export const tauriReadyCheck = (): boolean =>
  typeof window !== "undefined" &&
  !!((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__) &&
  !!((window as any).Liatir);

export const waitTauri = async () => {
  const interval: number=500;
  let counter: number=0;
  while(counter<=30000 && !tauriReadyCheck()){
    await wait(interval);
    counter=counter+interval;
  }
}


/** 
 * Detects if running inside a native Tauri WebView.
 * Checks global objects (__TAURI__ / __TAURI_INTERNALS__)
 */
export function isTauri(): boolean {
  // --- Fast sync path ---
  if (
    typeof window !== "undefined" &&
    (typeof (window as any).__TAURI__ !== "undefined" ||
     typeof (window as any).__TAURI_INTERNALS__ !== "undefined")
  ) return true;
  else return false;
}