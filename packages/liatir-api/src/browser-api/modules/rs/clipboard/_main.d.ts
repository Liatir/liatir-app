/**
 * `Liatir.desktop.clipboard` — read and write the system clipboard.
 */
import type { LiatirAPI, ClipboardInterface } from "../../../types";
export declare function buildClipboard(core: {
    invoke: LiatirAPI["invoke"];
}): ClipboardInterface;
