import { LiatirAPI } from "../../../liatir/_types";
export declare const tauriReadyCheck: () => boolean;
export declare const waitTauri: () => Promise<void>;
export declare const newWindow: (core: {
    invoke: LiatirAPI["invoke"];
}, options?: {
    label?: string;
    fullscreen?: boolean;
    url?: string;
}) => Promise<void>;
export declare const closeWindow: (core: {
    invoke: LiatirAPI["invoke"];
}, label: string) => Promise<void>;
