import { LiatirAPI } from "../../../types";
import { SidecarInterface } from "./_types";
export declare function buildSidecar(core: {
    invoke: LiatirAPI["invoke"];
}): SidecarInterface;
