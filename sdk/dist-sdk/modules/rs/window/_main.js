"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWindow = buildWindow;
const _helpers_1 = require("./_helpers");
function buildWindow(core) {
    const randomWindowLabel = `w_${Math.random().toString(36).substring(2, 2 + 8)}`;
    return {
        minimize: (label) => core.invoke("lia_win_minimize", { label: label ?? "main" }),
        maximizeToggle: (label) => core.invoke("lia_win_maximize", { label: label ?? "main" }),
        fullscreen: (enable, label) => core.invoke("lia_win_fullscreen", { enable, label: label ?? "main" }),
        new: async (options) => (0, _helpers_1.newWindow)(core, options),
        close: (label) => (0, _helpers_1.closeWindow)(core, label),
        getInfo: (label) => core.invoke("lia_win_get_info", { label }),
    };
}
