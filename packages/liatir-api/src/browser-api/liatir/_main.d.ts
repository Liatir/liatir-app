import { LiatirInstanceInterface } from "../types";
/** Safe access to the global. `get()` throws rather than returning undefined, so a missing bridge is loud. */
export declare const LiatirInstance: LiatirInstanceInterface;
/** Fires the ready event. Called by `bridge.ts` once Tauri has actually come up. */
export declare const liaInitiators: () => Promise<void>;
/** `Liatir.onReady(cb)` — the public way to wait for the bridge. */
export declare const liaReadyEventListener: (callback: Function) => void;
