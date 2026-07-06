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
export declare const tauriReadyCheck: () => boolean;
export declare const waitTauri: () => Promise<void>;
/**
 * Detects if running inside a native Tauri WebView.
 * Checks global objects (__TAURI__ / __TAURI_INTERNALS__)
 */
export declare function isTauri(): boolean;
