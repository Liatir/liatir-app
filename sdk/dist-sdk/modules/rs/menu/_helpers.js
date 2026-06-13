"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initMenuConfig = void 0;
const utils_1 = require("../../../utils");
function isMacOS() {
    if (typeof navigator === "undefined") {
        return false;
    }
    return true;
}
const initMenuConfig = async (core, menuConfig, windowLabel) => {
    validateMenuConfig(menuConfig);
    if (windowLabel) {
        if (isMacOS()) {
            console.warn("[Desktopr] Native window-specific menus are not supported on macOS.");
            return;
        }
        await core.invoke("dtr_init_menu_for_window_from_json", {
            windowLabel,
            cfgJson: menuConfig /*, is_base64: false*/,
        });
    }
    else {
        await core.invoke("dtr_init_menu_from_json", {
            cfgJson: menuConfig /*, is_base64: false*/,
        });
    }
};
exports.initMenuConfig = initMenuConfig;
/**
 * Public entry point — validates a menu configuration object before sending it
 * to Rust. Throws an Error if invalid. Depth control is internal only.
 */
function validateMenuConfig(config) {
    _validateMenuConfig(config);
}
// ---- Internal recursive implementation ----
function _validateMenuConfig(config) {
    if (typeof config !== "object" || config === null)
        throw new Error("Menu config must be an object.");
    if (utils_1.validate.emptyObject(config))
        throw new Error(`Menu config is an empty object:\n\n${config}`);
    if (typeof config.enabled !== "boolean")
        throw new Error("Missing or invalid 'enabled' (boolean required).");
    if (!Array.isArray(config.platforms))
        throw new Error("Missing or invalid 'platforms' (array required).");
    for (const p of config.platforms) {
        if (!["macos", "windows", "linux"].includes(p))
            throw new Error(`Invalid platform '${p}'.`);
    }
    const validSections = ["macosRoot", "file", "edit", "view", "window", "tray"];
    for (const key of validSections) {
        if (config[key]) {
            validateSection(config[key], key);
        }
    }
}
function validateSection(section, name) {
    if (typeof section !== "object" || section === null)
        throw new Error(`Section '${name}' must be an object.`);
    if (!Array.isArray(section.items))
        throw new Error(`Section '${name}' missing or invalid 'items' array.`);
    validateItems(section.items, `${name}.items`);
}
function validateItems(items, path) {
    if (!Array.isArray(items))
        throw new Error(`${path} must be an array.`);
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const loc = `${path}[${i}]`;
        if (typeof item !== "object" || item === null)
            throw new Error(`${loc} must be an object.`);
        const type = item.type;
        if (typeof type !== "string")
            throw new Error(`${loc} missing 'type' field.`);
        switch (type) {
            case "custom": {
                if (typeof item.id !== "string")
                    throw new Error(`${loc} missing 'id' (string).`);
                if (typeof item.label !== "string")
                    throw new Error(`${loc} missing 'label' (string).`);
                if (item.enabled !== undefined && typeof item.enabled !== "boolean")
                    throw new Error(`${loc} invalid 'enabled' type (boolean expected).`);
                if (item.interaction !== undefined &&
                    !["click", "check"].includes(item.interaction))
                    throw new Error(`${loc} invalid 'interaction' value.`);
                if (item.interaction === "check" &&
                    item.checked !== undefined &&
                    typeof item.checked !== "boolean")
                    throw new Error(`${loc} invalid 'checked' for checkable item (boolean expected).`);
                if (item.accelerator !== undefined &&
                    typeof item.accelerator !== "string")
                    throw new Error(`${loc} invalid 'accelerator' type (string expected).`);
                break;
            }
            case "submenu": {
                if (typeof item.label !== "string")
                    throw new Error(`${loc} submenu missing 'label' (string).`);
                if (!Array.isArray(item.items))
                    throw new Error(`${loc} submenu missing 'items' array.`);
                for (const sub of item.items) {
                    if (sub.type === "submenu") {
                        throw new Error(`${loc} submenu contains another submenu — only one level of depth allowed.`);
                    }
                }
                break;
            }
            case "predefined": {
                if (typeof item.item !== "string")
                    throw new Error(`${loc} predefined item missing 'item' field.`);
                if (item.customLabel !== undefined &&
                    typeof item.customLabel !== "string")
                    throw new Error(`${loc} invalid 'customLabel' type (string expected).`);
                break;
            }
            case "separator":
                break;
            default:
                throw new Error(`${loc} has unknown type '${type}'.`);
        }
    }
}
