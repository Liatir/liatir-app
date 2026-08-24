/**
 * `Liatir.desktop.network` — connectivity status and probes.
 *
 * `setMonitor` starts a background poll that pushes `network:status` events, so the app can react to going
 * offline mid-download rather than only discovering it when a request fails.
 */
import type { LiatirAPI, } from "../../../types";
import { U64 } from "../../../utils";
import { NetworkInterface } from "./_types";

export function buildNetwork(core: { invoke: LiatirAPI["invoke"] }): NetworkInterface {
  return {
    status: (): Promise<void> => core.invoke("lia_network_get_status"),
    ping: (url: string, timeoutMs?: U64): Promise<void> => core.invoke("lia_network_ping", {url: url??"", timeoutMs}),
    resolve: (host: string): Promise<void> => core.invoke("lia_network_resolve", {host}),
    estimateBandwidth: (url?: string, sizeHintBytes?: U64, timeoutMs?: U64): Promise<void> => core.invoke("lia_network_bandwidth_estimate", {url, sizeHintBytes, timeoutMs}),
    setMonitor: (intervalMs?: U64, targets?: string[]): Promise<void> => core.invoke("lia_network_set_monitor", {intervalMs:intervalMs??3000, targets}),
    stopMonitor: (): Promise<void> => core.invoke("lia_network_stop_monitor"),
    request: (request) => core.invoke("lia_http_request", { request }),
    cancelRequest: (requestId) => core.invoke("lia_http_request_cancel", { requestId }),
  };
}
