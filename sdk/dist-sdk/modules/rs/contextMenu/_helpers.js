"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeContextMenuListener = exports.initContextMenuListener = exports.CM_TYPES = void 0;
exports.isCmType = isCmType;
exports.parseCmType = parseCmType;
exports.normalizeEntries = normalizeEntries;
const helpers_1 = require("../../../helpers");
const utils_1 = require("../../../utils");
// Keep CM_TYPES as a readonly tuple and assert it matches CmType[]
exports.CM_TYPES = [
    "item",
    "check",
    "separator",
    "submenu",
    "predefined",
];
// Narrow to CmType by inclusion
function isCmType(value) {
    return (typeof value === "string" && exports.CM_TYPES.includes(value));
}
/**
 * Normalize any unknown value into a CmType if possible:
 * - must be a non-empty string
 * - lowercased
 * - whitespace removed
 * - must be one of CM_TYPES
 */
function parseCmType(value) {
    if (!utils_1.validate.nonEmptyString(value))
        return null;
    const normalized = (0, helpers_1.normalizeString)(value);
    return isCmType(normalized) ? normalized : null;
}
/**
 * Return only entries with a valid, normalized type.
 * Does not mutate input entries.
 */
function normalizeEntries(entries) {
    const out = [];
    for (const entry of entries) {
        const t = parseCmType(entry?.type);
        if (!t)
            continue;
        out.push({ ...entry, type: t });
    }
    return out;
}
const onCmClick = (ev, callback, preventDefault = true) => {
    try {
        // Prevent the native context menu when showing the custom one.
        if (preventDefault)
            ev.preventDefault();
        // Actual event target; text nodes are cast to HTMLElement for simplicity.
        const target = ev.target;
        // Walk up to the nearest actionable element.
        const ancestorActionable = target?.closest("[data-lia-contextmenu]") ?? null;
        const descendantActionable = target?.querySelector("[data-lia-contextmenu]") ?? null;
        const info = {
            targetTag: target?.tagName ?? null,
            targetId: target?.id ?? null,
            targetClasses: target?.className ?? null,
            ancestorActionable,
            descendantActionable,
            // coordinate
            pageX: ev.pageX, // rispetto al documento (scorrimento incluso)
            pageY: ev.pageY,
            clientX: ev.clientX, // rispetto alla viewport
            clientY: ev.clientY,
            screenX: ev.screenX, // coordinate dello schermo
            screenY: ev.screenY,
            altKey: ev.altKey,
            ctrlKey: ev.ctrlKey,
            shiftKey: ev.shiftKey,
            metaKey: ev.metaKey,
        };
        if (!window?.Liatir)
            throw new Error("[contextmenu listener] Liatir not found");
        window.Liatir.desktop.events.emit("cm:click", info);
        const callbackPlayload = {
            event: ev,
            ...info
        };
        if (callback)
            callback(callbackPlayload);
    }
    catch (error) {
        console.error(error);
    }
};
const initContextMenuListener = (callback, preventDefault = true) => {
    if (!window?.Liatir)
        throw new Error("[contextmenu listener] Liatir not found");
    const listening = window.Liatir.desktop.contextMenu.listening;
    if (listening)
        return console.warn("[contextmenu listener] already initialized");
    // listener globale: intercetta i click col destro su qualunque elemento della pagina
    const listener = (ev) => onCmClick(ev, callback, preventDefault);
    window.Liatir.desktop.contextMenu.listener = listener;
    document.addEventListener("contextmenu", listener);
    window.Liatir.desktop.contextMenu.listening = true;
};
exports.initContextMenuListener = initContextMenuListener;
const removeContextMenuListener = () => {
    if (!window?.Liatir)
        throw new Error("[contextmenu listener] Liatir not found");
    const listening = window.Liatir.desktop.contextMenu.listening;
    if (!listening)
        return;
    const listener = window.Liatir.desktop.contextMenu.listener ?? (() => { });
    document.removeEventListener("contextmenu", listener);
    window.Liatir.desktop.contextMenu.listening = false;
    window.Liatir.desktop.contextMenu.listener = undefined;
};
exports.removeContextMenuListener = removeContextMenuListener;
