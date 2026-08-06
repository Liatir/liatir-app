/**
 * `Liatir.deps` — is a command-line tool present on this machine, and at what version?
 *
 * Each check shells out, so `checkMany` exists to probe a whole set in one round trip rather than one call per
 * binary — which is what the Dependencies screen and the startup check need.
 */
import { LiatirAPI } from "../../../types";
import { DepsInterface } from "./_types";
export declare function buildDeps(core: {
    invoke: LiatirAPI["invoke"];
}): DepsInterface;
