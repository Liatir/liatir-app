import { LiatirAPI } from "../../../types";
import { PluginsInterface } from "./_types";
export declare function buildPlugins(core: {
    invoke: LiatirAPI["invoke"];
}): PluginsInterface;
