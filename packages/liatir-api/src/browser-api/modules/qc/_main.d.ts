import { QcInterface } from "./_types";
import type { LiatirAPI } from "../../types";
export declare function buildQc(core: {
    invoke: LiatirAPI["invoke"];
}): QcInterface;
