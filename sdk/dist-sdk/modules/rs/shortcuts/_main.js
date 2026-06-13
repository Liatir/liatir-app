"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildShortcuts = buildShortcuts;
const helpers_1 = require("../../../helpers");
function buildShortcuts(core) {
    return {
        register: async (accelerator, cb, options) => {
            const gs = (0, helpers_1.tauriGlobalShortcut)();
            await gs.register(accelerator, async (e) => {
                const payload = { accelerator, ...e };
                if (options?.emitEvent)
                    await core.invoke("dtr_event_emit", { event: "shortcut:event", payload });
                cb(payload);
            });
        },
        unregister: async (accelerator) => {
            const gs = (0, helpers_1.tauriGlobalShortcut)();
            const reg = await gs.isRegistered(accelerator);
            if (reg)
                await gs.unregister(accelerator);
        },
        unregisterAll: async () => {
            const gs = (0, helpers_1.tauriGlobalShortcut)();
            await gs.unregisterAll();
        },
        isRegistered: async (accelerator) => {
            const gs = (0, helpers_1.tauriGlobalShortcut)();
            return gs.isRegistered(accelerator);
        },
    };
}
