import type { LiatirAPI } from "../../../types";
import { AutostartInterface } from "./_types";
export declare function buildAutostart(core: {
    invoke: LiatirAPI["invoke"];
}): AutostartInterface;
