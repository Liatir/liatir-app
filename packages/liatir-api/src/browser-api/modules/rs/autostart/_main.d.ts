/**
 * `Liatir.desktop.autostart` — launch Liatir when the user logs in.
 *
 * `mode` controls *how* it starts (visible, or in the background), which is a separate decision from whether
 * it starts at all — hence the two levels.
 */
import type { LiatirAPI } from "../../../types";
import { AutostartInterface } from "./_types";
export declare function buildAutostart(core: {
    invoke: LiatirAPI["invoke"];
}): AutostartInterface;
