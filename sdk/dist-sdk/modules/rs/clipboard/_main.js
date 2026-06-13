"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildClipboard = buildClipboard;
function buildClipboard(core) {
    return {
        readText: () => core.invoke("dtr_clipboard_read"),
        writeText: (text) => core.invoke("dtr_clipboard_write", { text }),
    };
}
