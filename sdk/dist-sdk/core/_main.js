"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCore = buildCore;
const helpers_1 = require("../helpers");
function buildCore() {
    return {
        get ready() {
            return (0, helpers_1.ensureCore)().then(() => true);
        },
        async invoke(cmd, payload) {
            const core = await (0, helpers_1.ensureCore)();
            return core.invoke(cmd, payload);
        },
    };
}
