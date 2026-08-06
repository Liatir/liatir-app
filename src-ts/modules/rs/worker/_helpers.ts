/** Internal helpers for the WASM worker module. */
export const normalizeModuleName = (name: string): string => {
    const sanitizeWasmExtensions: string = name.replaceAll(".wasm","");
    const addWasmExtensions: string = `${sanitizeWasmExtensions}.wasm`;
    return addWasmExtensions;
}