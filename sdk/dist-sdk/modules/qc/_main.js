"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildQc = buildQc;
const _main_1 = require("./fastqc/_main");
function buildQc(deps) {
    return {
        fastqc: (0, _main_1.buildFastqc)(deps.plugins),
    };
}
