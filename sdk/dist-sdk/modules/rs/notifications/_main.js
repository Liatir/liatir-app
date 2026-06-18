"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildNotifications = buildNotifications;
function buildNotifications(core) {
    return {
        state: () => core.invoke("lia_notification_state"),
        request: () => core.invoke("lia_request_permission"),
        show: (title, body) => core.invoke("lia_notify", { title, body }),
    };
}
