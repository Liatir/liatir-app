/**
 * `Liatir.desktop.network` — connectivity status and probes.
 *
 * `setMonitor` starts a background poll that pushes `network:status` events, so the app can react to going
 * offline mid-download rather than only discovering it when a request fails.
 */
import type { LiatirAPI } from "../../../types";
import { NetworkInterface } from "./_types";
export declare function buildNetwork(core: {
    invoke: LiatirAPI["invoke"];
}): NetworkInterface;
