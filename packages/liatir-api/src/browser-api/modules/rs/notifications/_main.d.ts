/**
 * `Liatir.desktop.notifications` — OS notifications.
 *
 * Permission is a three-state affair (unknown / granted / denied), so `state` and `request` are exposed
 * separately from `show`: a caller can ask whether it *may* notify without triggering the system prompt.
 */
import type { LiatirAPI, NotificationsInterface } from "../../../types";
export declare function buildNotifications(core: {
    invoke: LiatirAPI["invoke"];
}): NotificationsInterface;
