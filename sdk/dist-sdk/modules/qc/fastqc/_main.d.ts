import { FastqcInterface } from "./_types";
import type { LiatirAPI } from "../../../types";
export declare function buildFastqc(core: {
    invoke: LiatirAPI["invoke"];
}): FastqcInterface;
