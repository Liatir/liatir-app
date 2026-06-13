import { DesktoprAPI } from "../../../types";
import type { FsInterface } from "../../../types";
export declare function buildFs(core: {
    invoke: DesktoprAPI["invoke"];
}): FsInterface;
