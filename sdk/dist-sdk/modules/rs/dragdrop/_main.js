"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDragDrop = buildDragDrop;
const helpers_1 = require("../../../helpers");
// Puoi esportare qui un builder che semplicemente re-esporta quella logica.
function buildDragDrop() {
    return {
        on: async (handler, options) => {
            const evs = ["dragdrop:enter", "dragdrop:drop", "dragdrop:cancel"];
            if (options?.includeHover)
                evs.push("dragdrop:hover");
            const offs = await Promise.all(evs.map((n) => (0, helpers_1.listenForEvent)(n, (p) => handler(n, p))));
            return () => offs.forEach((off) => off());
        },
    };
}
