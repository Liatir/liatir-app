/**
 * `Liatir.desktop.events` — sending and receiving events across the app.
 *
 * This is how the backend pushes things that are not a response to a call: download progress, job output, drag
 * and drop, deep links. Every subscriber gets back an *unsubscribe* function, and the composite subscriptions
 * below (`onMany`, `onDragDrop`) return one that detaches all of their listeners at once — so a caller never
 * has to track several handles to clean up one logical subscription.
 */
import { LiatirAPI } from "../../../types";
import type { EventsInterface } from "../../../types";
export declare function buildEvents(core: {
    invoke: LiatirAPI["invoke"];
}): EventsInterface;
