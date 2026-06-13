export const normalizeModuleName = (name: string): string => {
    const sanitizeWasmExtensions: string = name.replaceAll(".wasm","");
    const addWasmExtensions: string = `${sanitizeWasmExtensions}.wasm`;
    return addWasmExtensions;
}