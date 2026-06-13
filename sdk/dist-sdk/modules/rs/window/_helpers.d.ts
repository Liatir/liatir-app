import { DesktoprAPI } from "../../../desktopr/_types";
export declare const tauriReadyCheck: () => boolean;
export declare const waitTauri: () => Promise<void>;
export declare const newWindow: (core: {
    invoke: DesktoprAPI["invoke"];
}, options?: {
    label?: string;
    fullscreen?: boolean;
    url?: string;
}) => Promise<void>;
export declare const closeWindow: (core: {
    invoke: DesktoprAPI["invoke"];
}, label: string) => Promise<void>;
