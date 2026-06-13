import type { DesktoprAPI } from "../../../types";
import { NetworkInterface } from "./_types";
export declare function buildNetwork(core: {
    invoke: DesktoprAPI["invoke"];
}): NetworkInterface;
