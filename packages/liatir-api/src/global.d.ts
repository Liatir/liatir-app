import type { LiatirBrowserAPI } from "./browser-api-types.bundle";

declare global {
  interface Window {
    Liatir?: LiatirBrowserAPI;
    __TAURI__?: any;
  }
}

export {};