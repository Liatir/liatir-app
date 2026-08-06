/** Shapes for OS notifications, including the three-state permission. */
export type NotificationPermission = "granted" | "denied" | "default" | string;
export interface NotificationsInterface {
    state: () => Promise<NotificationPermission>;
    request: () => Promise<Exclude<NotificationPermission, "default"> | string>;
    show: (title: string, body: string) => Promise<void>;
}
