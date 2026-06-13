import type { DesktoprAPI, NotificationsInterface } from "../../../types";

export function buildNotifications(core: { invoke: DesktoprAPI["invoke"] }): NotificationsInterface {
  return {
    state: (): Promise<string> => core.invoke("dtr_notification_state"),
    request: (): Promise<string> => core.invoke("dtr_request_permission"),
    show: (title: string, body: string): Promise<void> => core.invoke("dtr_notify", { title, body }),
  };
}
