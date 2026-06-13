import { TauriCore, WindowTauri } from "../types";
export declare function extractCore(source: unknown): TauriCore | null;
export declare const ensureCore: () => Promise<TauriCore>;
export declare const windowTauriProxy: WindowTauri;
