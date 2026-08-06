

/**
 * Bridge constants.
 *
 * The app URL and API version come from a generated JSON file rather than being hard-coded, so the bridge and
 * the build agree on them without either having to be edited by hand.
 */
import CONSTANTS from "./bridge.constants.json";

export const APP_URL: string = CONSTANTS.appUrl!;
export const API_VERSION: string = CONSTANTS.apiVersion!;

/** The DOM event fired once the bridge can talk to Rust — see `liatir/_main.ts`. */
export const READY_EVENT_NAME: string = "liaReady";

// These two carry a random suffix on purpose. They name a global variable and a storage namespace that live in
// the same space as page code, so an unguessable name is what stops a plugin (or any script in the webview)
// from colliding with them — by accident or otherwise.
export const WINDOWS_LABELS_TRACKER_VARIABLE_NAME: string = "open-windows-labels-tracker-rpkw6kjzxn8bfhj5u74q";

export const BROWSER_STORAGE_NAMESPACE: string = "lia_xam8wknpz1vf";