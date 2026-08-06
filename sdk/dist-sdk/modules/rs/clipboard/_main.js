"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildClipboard = buildClipboard;
function buildClipboard(core) {
    return {
        readText: () => core.invoke("lia_clipboard_read"),
        writeText: (text) => core.invoke("lia_clipboard_write", { text }),
    };
}
