"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWindow = buildWindow;
const _helpers_1 = require("../companion/_helpers");
const _helpers_2 = require("./_helpers");
function buildWindow(core) {
    const randomWindowLabel = `w_${Math.random().toString(36).substring(2, 2 + 8)}`;
    return {
        minimize: (label) => core.invoke("dtr_win_minimize", { label: label ?? "main" }),
        maximizeToggle: (label) => core.invoke("dtr_win_maximize", { label: label ?? "main" }),
        fullscreen: (enable, label) => core.invoke("dtr_win_fullscreen", { enable, label: label ?? "main" }),
        new: async (options) => {
            if (options?.cacheOnly)
                (0, _helpers_1.launchCompanion)(core, {
                    title: options?.label,
                    url: options?.url,
                    openFullscreen: options?.fullscreen
                });
            else
                (0, _helpers_2.newWindow)(core, options);
        },
        close: (label) => (0, _helpers_2.closeWindow)(core, label),
        getInfo: (label) => core.invoke("dtr_win_get_info", { label }),
        state: {}
    };
}
