import type { OfflabAPI } from "./types";
declare global { interface Window { Offlab?: OfflabAPI, __TAURI__?: any} }
export {};
