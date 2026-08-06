/**
 * `Liatir.desktop.window` — window management.
 *
 * Every method defaults to the `main` window, so the common case needs no label. A label is only required
 * when the app has opened additional windows (a standalone Quenta window, for instance).
 */
import type { LiatirAPI, WindowInterface } from "../../../types";
export declare function buildWindow(core: {
    invoke: LiatirAPI["invoke"];
}): WindowInterface;
