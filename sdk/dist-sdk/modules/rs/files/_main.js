"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFiles = buildFiles;
function buildFiles(core) {
    return {
        open: (options) => core.invoke("dtr_file_open", { multi: options?.multi ?? false, allowedExtensions: options?.allowed, maxBytes: options?.maxBytes }),
        openWithBytes: (options) => core.invoke("dtr_file_open_with_bytes", { multi: options?.multi ?? false, allowedExtensions: options?.allowed, maxBytes: options?.maxBytes }),
        save: (defaultName) => core.invoke("dtr_file_save", { defaultName: defaultName ?? null }),
    };
}
