"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildContextMenu = buildContextMenu;
const helpers_1 = require("../../../helpers");
function buildContextMenu(core) {
    return {
        show: (entries, options) => core.invoke("dtr_context_menu_popup", { items: (0, helpers_1.normalizeEntries)(entries), options }),
        handler: {
            init: helpers_1.initContextMenuListener,
            remove: helpers_1.removeContextMenuListener
        }
    };
}
