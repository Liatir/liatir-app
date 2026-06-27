import { LiatirAPI } from "../../../types";
import type { FsInterface } from "../../../types";
export declare function buildFs(core: {
    invoke: LiatirAPI["invoke"];
}): FsInterface;
