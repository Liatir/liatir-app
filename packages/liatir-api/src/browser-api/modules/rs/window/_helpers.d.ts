import { LiatirAPI } from "../../../liatir/_types";
import type { NewWindowOptions } from "./_types";
/** Both must be present: Tauri's own runtime, *and* the bridge that was injected on top of it. */
export declare const tauriReadyCheck: () => boolean;
/**
 * Polls until Tauri is ready, giving up after 30 seconds.
 *
 * A poll rather than an event, because there is nothing to listen *to* before Tauri exists. The timeout is what
 * distinguishes "still starting" from "not a desktop app at all" — in a plain browser this simply expires, and
 * `bridge.ts` treats that as the expected outcome rather than an error.
 */
export declare const waitTauri: () => Promise<void>;
/**
 * Opens a window, generating a label when the caller does not supply one.
 *
 * `main` is reserved for the app's own window: allowing a caller to claim it would let a plugin address — or
 * replace — the main window, so the name is refused outright.
 */
export declare const newWindow: (core: {
    invoke: LiatirAPI["invoke"];
}, options?: NewWindowOptions) => Promise<void>;
export declare const closeWindow: (core: {
    invoke: LiatirAPI["invoke"];
}, label: string) => Promise<void>;
