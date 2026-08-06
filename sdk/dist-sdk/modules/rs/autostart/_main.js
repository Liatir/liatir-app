"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAutostart = buildAutostart;
function buildAutostart(core) {
    return {
        enable: () => core.invoke("lia_autostart_enable"),
        disable: () => core.invoke("lia_autostart_disable"),
        isEnabled: () => core.invoke("lia_autostart_status"),
        mode: {
            get: () => core.invoke("lia_get_autostart_mode"),
            set: (mode) => core.invoke("lia_set_autostart_mode", { mode }),
        }
    };
}
