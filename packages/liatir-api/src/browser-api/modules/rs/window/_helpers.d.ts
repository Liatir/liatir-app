import { LiatirAPI } from "../../../liatir/_types";
import type { NewWindowOptions } from "./_types";
export declare const tauriReadyCheck: () => boolean;
export declare const waitTauri: () => Promise<void>;
export declare const newWindow: (core: {
    invoke: LiatirAPI["invoke"];
}, options?: NewWindowOptions) => Promise<void>;
export declare const closeWindow: (core: {
    invoke: LiatirAPI["invoke"];
}, label: string) => Promise<void>;
