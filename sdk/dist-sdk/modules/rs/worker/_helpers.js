"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeModuleName = void 0;
const normalizeModuleName = (name) => {
    const sanitizeWasmExtensions = name.replaceAll(".wasm", "");
    const addWasmExtensions = `${sanitizeWasmExtensions}.wasm`;
    return addWasmExtensions;
};
exports.normalizeModuleName = normalizeModuleName;
