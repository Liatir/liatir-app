/**
 * `Liatir.desktop.worker` — calls into the WASM worker.
 *
 * Runs a module out of the main thread, so a long computation cannot freeze the UI. `timeoutMs` matters here:
 * a WASM module has no way of being interrupted from outside, so a bound on how long it may run is the only
 * protection against one that never returns.
 */
import { LiatirAPI } from "../../../types";
import { U64, U8 } from "../../../utils";
import { WorkerCallPayload } from "./_types";
export declare function buildWorker(core: {
    invoke: LiatirAPI["invoke"];
}): {
    call: (method: string, payload: WorkerCallPayload, timeoutMs?: U64) => Promise<string>;
    status: () => Promise<boolean>;
    restart: () => Promise<boolean>;
    modules: {
        list: () => Promise<string[]>;
        remove: (name: string) => Promise<boolean>;
        addFromBytes: (name: string, contents: U8[]) => Promise<boolean>;
        add: (name: string, maxBytes?: U64) => Promise<boolean>;
    };
    clearSandbox: () => Promise<boolean>;
    paths: () => Promise<{
        externalModules: string;
        sandbox: string;
    }>;
};
