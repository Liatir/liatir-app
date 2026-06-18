"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildNetwork = buildNetwork;
function buildNetwork(core) {
    return {
        status: () => core.invoke("lia_network_get_status"),
        ping: (url, timeoutMs) => core.invoke("lia_network_ping", { url: url ?? "", timeoutMs }),
        resolve: (host) => core.invoke("lia_network_resolve", { host }),
        estimateBandwidth: (url, sizeHintBytes, timeoutMs) => core.invoke("lia_network_bandwidth_estimate", { url, sizeHintBytes, timeoutMs }),
        setMonitor: (intervalMs, targets) => core.invoke("lia_network_set_monitor", { intervalMs: intervalMs ?? 3000, targets }),
        stopMonitor: () => core.invoke("lia_network_stop_monitor"),
    };
}
