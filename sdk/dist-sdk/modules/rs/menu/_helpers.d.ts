import { DesktoprAPI, MenuConfig } from "../../../types";
export declare const initMenuConfig: (core: {
    invoke: DesktoprAPI["invoke"];
}, menuConfig: MenuConfig, windowLabel?: string) => Promise<void>;
