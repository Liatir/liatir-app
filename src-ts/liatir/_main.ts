/**
 * The bridge's readiness signal.
 *
 * `window.Liatir` exists from the first line of page code, but Tauri behind it becomes usable slightly later.
 * Code that must not run until the connection is live (registering listeners, reading app info) waits for the
 * ready event instead of guessing at a delay.
 *
 * A DOM `CustomEvent` on `window` is used rather than a callback registry, so anything in the page — the
 * frontend, a plugin, a script the user pasted into the console — can listen for it without needing a
 * reference to the bridge's internals.
 */
import { READY_EVENT_NAME } from "../constants";
import { LiatirBrowserAPI, LiatirInstanceInterface } from "../types";
import { Liatir } from "../sdk";

/** Safe access to the global. `get()` throws rather than returning undefined, so a missing bridge is loud. */
export const LiatirInstance: LiatirInstanceInterface = {
    ready: (): boolean => {
        if(!window?.Liatir) return false;
        return true;
    },
    get: (): LiatirBrowserAPI => {
        if(!LiatirInstance.ready()) throw("'window.Liatir' not found");
        return window?.Liatir as LiatirBrowserAPI;
    }
}

/** Fires the ready event. Called by `bridge.ts` once Tauri has actually come up. */
export const liaInitiators = async () => {
    try {
        if(!LiatirInstance.ready()) throw("Liatir instance not found");

        console.log("## READY ##");

        const eventReady = new CustomEvent(READY_EVENT_NAME);

        window?.dispatchEvent(eventReady);
    } catch (error) {
        // Logged rather than rethrown: this runs detached in the init script, where a throw would go nowhere.
        console.error(error);
    }
}

/** `Liatir.onReady(cb)` — the public way to wait for the bridge. */
export const liaReadyEventListener = (callback: Function) => window.addEventListener(READY_EVENT_NAME, () => callback());
