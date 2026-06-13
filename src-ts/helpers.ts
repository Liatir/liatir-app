export * from "./core/_helpers";
export * from "./desktopr/_helpers";
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
export * from "./modules/rs/companion/_helpers";
export * from "./modules/rs/globalVariables/_helpers";


import { wait } from "./utils";

export const tauriReadyCheck = (): boolean => (typeof window !== "undefined" && ((window as any).__TAURI__) && ((window as any).Desktopr));

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