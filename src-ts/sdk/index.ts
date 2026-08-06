// Main SDK entry: typed browser/webview proxy over window.Liatir.
export { Liatir, isLiatirAvailable } from "./_proxy";

// LiatirBrowserAPI is the explicit type for window.Liatir.
// LiatirAPI remains exported as a deprecated compatibility alias.
export { type LiatirBrowserAPI, type LiatirAPI } from "../types";
