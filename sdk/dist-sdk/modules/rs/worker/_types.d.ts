import type { U64, U8 } from "../../../utils/utils/_integerUtils";
export interface WorkerInterface {
    call: (method: string, payload: WorkerCallPayload, timeoutMs?: U64) => Promise<string>;
    status: () => Promise<boolean>;
    restart: () => Promise<boolean>;
    modules: {
        list: () => Promise<string[]>;
        remove: (name: string) => Promise<boolean>;
        addFromBytes: (name: string, contents: U8[]) => Promise<boolean>;
        add: (name: string, maxBytes?: U64 | undefined) => Promise<boolean>;
    };
    clearSandbox: () => Promise<boolean>;
    paths: () => Promise<{
        externalModules: string;
        sandbox: string;
    }>;
}
export type WorkerCallPayload = {
    fn: string;
    args: number[];
    [key: string]: any;
};
