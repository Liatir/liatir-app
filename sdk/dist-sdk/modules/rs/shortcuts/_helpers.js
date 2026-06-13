"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tauriGlobalShortcut = void 0;
const tauriGlobalShortcut = () => {
    const g = window.__TAURI__?.globalShortcut;
    if (!g)
        throw new Error("Global Shortcut plugin not available");
    return g;
};
exports.tauriGlobalShortcut = tauriGlobalShortcut;
