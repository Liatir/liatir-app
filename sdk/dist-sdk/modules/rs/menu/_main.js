"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMenu = buildMenu;
const helpers_1 = require("../../../helpers");
function buildMenu(core) {
    return {
        setEnabled: (id, enabled) => core.invoke("lia_menu_set_enabled", { id, enabled }),
        setChecked: (id, checked) => core.invoke("lia_menu_set_checked", { id, checked }),
        init: {
            fromConfig: (config, windowLabel) => (0, helpers_1.initMenuConfig)(core, config, windowLabel),
            fromJsonFile: (filePath) => core.invoke("lia_init_menu_from_file", { filePath })
        }
    };
}
