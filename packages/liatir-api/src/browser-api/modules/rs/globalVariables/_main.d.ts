/**
 * `Liatir.desktop.globalVariables` — a small persistent key/value store shared across the app.
 *
 * Used for values that must outlive a single run or window (the companion URL, for instance). Note that in the
 * plugin-dev sandbox these keys are namespaced, so a plugin under test cannot read or clobber the real app's
 * variables.
 */
import { LiatirAPI } from "../../../types";
import { GlobalVariablesInterface } from "./_types";
export declare function buildGlobVar(core: {
    invoke: LiatirAPI["invoke"];
}): GlobalVariablesInterface;
