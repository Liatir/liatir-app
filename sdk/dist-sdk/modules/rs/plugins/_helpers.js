"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePluginName = void 0;
const normalizePluginName = (name) => {
    const sanitizeWasmExtensions = name.replaceAll(".wasm", "");
    const addWasmExtensions = `${sanitizeWasmExtensions}.wasm`;
    return addWasmExtensions;
};
exports.normalizePluginName = normalizePluginName;
