import type { DesktoprAPI } from "./types";
declare global { interface Window { Desktopr?: DesktoprAPI, __TAURI__?: any} }
export {};
