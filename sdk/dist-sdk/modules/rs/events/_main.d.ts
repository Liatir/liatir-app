import { DesktoprAPI } from "../../../types";
import type { EventsInterface } from "../../../types";
export declare function buildEvents(core: {
    invoke: DesktoprAPI["invoke"];
}): EventsInterface;
