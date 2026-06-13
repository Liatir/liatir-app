"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBadge = buildBadge;
const helpers_1 = require("../../../helpers");
function buildBadge(core) {
    return {
        set: async (count) => {
            await (0, helpers_1.platformSpecifcFilter)(["macos"]);
            core.invoke("dtr_badge_set", { count });
        },
        clear: async () => {
            await (0, helpers_1.platformSpecifcFilter)(["macos"]);
            core.invoke("dtr_badge_clear");
        },
    };
}
