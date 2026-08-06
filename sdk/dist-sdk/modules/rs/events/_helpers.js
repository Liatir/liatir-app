"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listenForEvent = void 0;
const listenForEvent = async (event, handler) => {
    // Use the injected Tauri API
    const tauri = window.__TAURI__;
    const eventApi = tauri?.event;
    if (!eventApi?.listen)
        throw new Error("Tauri event API not available");
    // Register listener and return the unlisten function directly
    const unlisten = await eventApi.listen(event, (e) => {
        // Forward only the payload to the user handler
        handler(e?.payload);
    });
    return unlisten;
};
exports.listenForEvent = listenForEvent;
