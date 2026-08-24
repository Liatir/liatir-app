/** Shapes for connectivity status, probes, and the background network monitor. */
import type { U64 } from "../../../utils/utils/_integerUtils";
import type { LiatirHttpRequest, LiatirHttpResponse } from "@liatir/core";
export interface NetworkInterface {
    status: () => Promise<void>;
    ping: (url: string, timeout?: U64) => Promise<void>;
    resolve: (host: string) => Promise<void>;
    estimateBandwidth: (url?: string, sizeHintBytes?: U64, timeout?: U64) => Promise<void>;
    setMonitor: (interval: U64, targets?: string[]) => Promise<void>;
    stopMonitor: () => Promise<void>;
    /** Perform an HTTP request in the native app, outside browser CORS restrictions. */
    request: (request: LiatirHttpRequest) => Promise<LiatirHttpResponse>;
    cancelRequest: (requestId: string) => Promise<boolean>;
}
