"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAppInfo = buildAppInfo;
function buildAppInfo(core) {
    return {
        info: () => core.invoke("lia_app_info"),
        exit: (code) => core.invoke("lia_app_exit", { code: code ?? 0 })
    };
}
