import type { LiatirBrowserAPI } from "./types";
declare global { interface Window { Liatir?: LiatirBrowserAPI, __TAURI__?: any} }
export {};
