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
