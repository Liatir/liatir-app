"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitTauri = exports.tauriReadyCheck = void 0;
exports.isTauri = isTauri;
__exportStar(require("./core/_helpers"), exports);
__exportStar(require("./desktopr/_helpers"), exports);
__exportStar(require("./modules/rs/files/_helpers"), exports);
__exportStar(require("./modules/rs/events/_helpers"), exports);
__exportStar(require("./modules/rs/fs/_helpers"), exports);
__exportStar(require("./modules/rs/clipboard/_helpers"), exports);
__exportStar(require("./modules/rs/shortcuts/_helpers"), exports);
__exportStar(require("./modules/rs/notifications/_helpers"), exports);
__exportStar(require("./modules/rs/app/_helpers"), exports);
__exportStar(require("./modules/rs/window/_helpers"), exports);
__exportStar(require("./modules/rs/dragdrop/_helpers"), exports);
__exportStar(require("./modules/rs/menu/_helpers"), exports);
__exportStar(require("./modules/rs/diagnostics/_helpers"), exports);
__exportStar(require("./modules/rs/network/_helpers"), exports);
__exportStar(require("./modules/rs/autostart/_helpers"), exports);
__exportStar(require("./modules/rs/badge/_helpers"), exports);
__exportStar(require("./modules/rs/worker/_helpers"), exports);
__exportStar(require("./modules/rs/contextMenu/_helpers"), exports);
__exportStar(require("./modules/rs/companion/_helpers"), exports);
__exportStar(require("./modules/rs/globalVariables/_helpers"), exports);
const utils_1 = require("./utils");
const tauriReadyCheck = () => (typeof window !== "undefined" && (window.__TAURI__) && (window.Desktopr));
exports.tauriReadyCheck = tauriReadyCheck;
const waitTauri = async () => {
    const interval = 500;
    let counter = 0;
    while (counter <= 30000 && !(0, exports.tauriReadyCheck)()) {
        await (0, utils_1.wait)(interval);
        counter = counter + interval;
    }
};
exports.waitTauri = waitTauri;
/**
 * Detects if running inside a native Tauri WebView.
 * Checks global objects (__TAURI__ / __TAURI_INTERNALS__)
 */
function isTauri() {
    // --- Fast sync path ---
    if (typeof window !== "undefined" &&
        (typeof window.__TAURI__ !== "undefined" ||
            typeof window.__TAURI_INTERNALS__ !== "undefined"))
        return true;
    else
        return false;
}
