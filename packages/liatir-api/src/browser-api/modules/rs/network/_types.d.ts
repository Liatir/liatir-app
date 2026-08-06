/** Shapes for connectivity status, probes, and the background network monitor. */
import type { U64 } from "../../../utils/utils/_integerUtils";
export interface NetworkInterface {
    status: () => Promise<void>;
    ping: (url: string, timeout?: U64) => Promise<void>;
    resolve: (host: string) => Promise<void>;
    estimateBandwidth: (url?: string, sizeHintBytes?: U64, timeout?: U64) => Promise<void>;
    setMonitor: (interval: U64, targets?: string[]) => Promise<void>;
    stopMonitor: () => Promise<void>;
}
