/**
 * `Liatir.desktop.notifications` — OS notifications.
 *
 * Permission is a three-state affair (unknown / granted / denied), so `state` and `request` are exposed
 * separately from `show`: a caller can ask whether it *may* notify without triggering the system prompt.
 */
import type { LiatirAPI, NotificationsInterface } from "../../../types";

export function buildNotifications(core: { invoke: LiatirAPI["invoke"] }): NotificationsInterface {
  return {
    state: (): Promise<string> => core.invoke("lia_notification_state"),
    request: (): Promise<string> => core.invoke("lia_request_permission"),
    show: (title: string, body: string): Promise<void> => core.invoke("lia_notify", { title, body }),
  };
}
