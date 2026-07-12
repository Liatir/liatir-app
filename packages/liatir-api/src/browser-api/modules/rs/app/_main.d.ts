/**
 * `Liatir.desktop.app` — app metadata (version, OS) and a clean exit.
 */
import { AppInterface, LiatirAPI } from "../../../types";
export declare function buildAppInfo(core: {
    invoke: LiatirAPI["invoke"];
}): AppInterface;
