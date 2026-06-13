"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEvents = buildEvents;
const helpers_1 = require("../../../helpers");
function buildEvents(core) {
    return {
        emit: (event, payload) => core.invoke("dtr_event_emit_to_current_window", { event, payload }),
        emitToAll: (event, payload) => core.invoke("dtr_event_emit", { event, payload }),
        emitTo: (windowLabel, event, payload) => core.invoke("dtr_event_emit_to", { windowLabel, event, payload }),
        on: async (event, handler) => (0, helpers_1.listenForEvent)(event, handler),
        once: (event) => new Promise(async (resolve) => {
            const off = await (0, helpers_1.listenForEvent)(event, (p) => {
                off();
                resolve(p);
            });
        }),
        onMany: async (events, handler) => {
            const offs = await Promise.all(events.map((n) => (0, helpers_1.listenForEvent)(n, (p) => handler(n, p))));
            return () => offs.forEach((off) => off());
        },
        onNetworkStatus: async (handler) => (0, helpers_1.listenForEvent)("network:status", handler),
        onDeeplink: async (handler) => (0, helpers_1.listenForEvent)("deeplink", handler),
        onShortcut: async (handler) => (0, helpers_1.listenForEvent)("shortcut:event", handler),
        onDragDrop: async (handler, options) => {
            const evs = ["dragdrop:enter", "dragdrop:drop", "dragdrop:cancel"];
            if (options?.includeHover)
                evs.push("dragdrop:hover");
            const offs = await Promise.all(evs.map((n) => (0, helpers_1.listenForEvent)(n, (p) => handler(n, p))));
            return () => offs.forEach((off) => off());
        },
        onMenuEvent: async (handler) => (0, helpers_1.listenForEvent)("menu:event", handler),
        onTrayIconEvent: async (handler) => (0, helpers_1.listenForEvent)("tray:icon", handler)
    };
}
