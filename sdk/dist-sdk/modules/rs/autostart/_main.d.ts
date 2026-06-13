import type { DesktoprAPI } from "../../../types";
import { AutostartInterface } from "./_types";
export declare function buildAutostart(core: {
    invoke: DesktoprAPI["invoke"];
}): AutostartInterface;
