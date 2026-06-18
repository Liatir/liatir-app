import type { LiatirAPI } from "./types";
declare global { interface Window { Liatir?: LiatirAPI, __TAURI__?: any} }
export {};
