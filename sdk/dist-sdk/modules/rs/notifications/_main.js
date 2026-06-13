"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildNotifications = buildNotifications;
function buildNotifications(core) {
    return {
        state: () => core.invoke("dtr_notification_state"),
        request: () => core.invoke("dtr_request_permission"),
        show: (title, body) => core.invoke("dtr_notify", { title, body }),
    };
}
