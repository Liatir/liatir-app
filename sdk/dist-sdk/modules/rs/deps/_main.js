"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDeps = buildDeps;
function buildDeps(core) {
    return {
        check: (binary) => core.invoke("lia_deps_check", { binary }),
        checkMany: (binaries) => core.invoke("lia_deps_check_many", { binaries }),
    };
}
