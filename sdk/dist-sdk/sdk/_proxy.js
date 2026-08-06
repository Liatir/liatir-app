"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Liatir = void 0;
exports.isLiatirAvailable = isLiatirAvailable;
function getWindow() {
    if (typeof window === "undefined") {
        throw new Error("[Liatir] window is not defined. Are you running in SSR?");
    }
    return window;
}
function getGlobalBridge() {
    const w = getWindow();
    const bridge = w.Liatir;
    if (!bridge) {
        console.error("[Liatir] window.Liatir is not available. Is the desktop wrapper loaded?");
        return;
    }
    return bridge;
}
function isLiatirAvailable() {
    if (typeof window === "undefined") {
        return false;
    }
    const w = window;
    return !!w.Liatir;
}
exports.Liatir = new Proxy({}, {
    get(_target, prop, _receiver) {
        const bridge = getGlobalBridge() ?? undefined;
        const value = bridge[prop];
        if (typeof value === "function") {
            return value.bind(bridge);
        }
        return value;
    },
    set(_target, prop, value) {
        const bridge = getGlobalBridge() ?? undefined;
        bridge[prop] = value;
        return true;
    }
});
