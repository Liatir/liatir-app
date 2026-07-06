import { ShortcutsInterface } from "../../../types";
export declare function buildShortcuts(core: {
    invoke: <T = unknown>(cmd: string, payload?: any) => Promise<T>;
}): ShortcutsInterface;
