import type { LiatirAPI } from "../../../types";
import { NetworkInterface } from "./_types";
export declare function buildNetwork(core: {
    invoke: LiatirAPI["invoke"];
}): NetworkInterface;
