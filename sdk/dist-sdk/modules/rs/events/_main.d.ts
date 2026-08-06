import { LiatirAPI } from "../../../types";
import type { EventsInterface } from "../../../types";
export declare function buildEvents(core: {
    invoke: LiatirAPI["invoke"];
}): EventsInterface;
