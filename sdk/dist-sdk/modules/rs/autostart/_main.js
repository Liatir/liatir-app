"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAutostart = buildAutostart;
function buildAutostart(core) {
    return {
        enable: () => core.invoke("dtr_autostart_enable"),
        disable: () => core.invoke("dtr_autostart_disable"),
        isEnabled: () => core.invoke("dtr_autostart_status"),
        mode: {
            get: () => core.invoke("dtr_get_autostart_mode"),
            set: (mode) => core.invoke("dtr_set_autostart_mode", { mode }),
        }
    };
}
