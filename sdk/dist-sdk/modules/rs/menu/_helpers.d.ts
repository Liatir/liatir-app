import { LiatirAPI, MenuConfig } from "../../../types";
export declare const initMenuConfig: (core: {
    invoke: LiatirAPI["invoke"];
}, menuConfig: MenuConfig, windowLabel?: string) => Promise<void>;
