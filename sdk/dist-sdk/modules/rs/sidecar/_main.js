"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSidecar = buildSidecar;
function buildSidecar(core) {
    return {
        run: (name, args) => core.invoke("lia_sidecar_run", { name, args }),
    };
}
