import { LiatirAPI } from "../../../types";
import { JobsInterface } from "./_types";
export declare function buildJobs(core: {
    invoke: LiatirAPI["invoke"];
}): JobsInterface;
