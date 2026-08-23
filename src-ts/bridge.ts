/**
 * The bridge: the entry point that creates `window.Liatir`.
 *
 * This file is compiled to `tsc/bridge.js` and embedded in the Rust binary (see `src/liatir.rs`), which
 * injects it into every webview *before* any page script runs. That is why `Liatir.*` is simply there as a
 * global for the frontend and for every `.lia` plugin — no import, no load order to get wrong.
 *
 * The whole API is assembled from `buildX(core)` factories, each of which wraps the `lia_*` Tauri commands of
 * one domain. `core` is the single point through which every call reaches Rust, so there is exactly one place
 * that knows how to invoke — and one place that waits for Tauri to be ready.
 *
 * The object is installed with `writable: false, configurable: false`: once set, page code cannot replace or
 * redefine `window.Liatir`, so a plugin (or anything else running in the webview) cannot substitute a fake API
 * and intercept what other code does with it.
 */
import type { LiatirBrowserAPI, WindowTauri } from "./types";
import {
  buildCore,
  buildFs,
  buildNotifications,
  buildClipboard,
  buildFiles,
  buildWindow,
  buildEvents,
  buildShortcuts,
  buildAppInfo,
  buildMenu,
  liaInitiators,
  buildDiagnostics,
  buildNetwork,
  buildAutostart,
  buildBadge,
  buildContextMenu,
  buildGlobVar,
  liaReadyEventListener,
} from "./main";
import { API_VERSION } from "./constants";
import { windowTauriProxy, tauriReadyCheck, waitTauri } from "./helpers";
import { buildJobs } from "./modules/rs/jobs/_main";
import { buildDeps } from "./modules/rs/deps/_main";
import { buildExternalWorkflows } from "./modules/rs/externalWorkflows/_main";
import { buildMcp } from "./modules/rs/mcp/_main";
import { buildQc } from "./modules/qc/_main";
import { isBrowser } from "./utils";

(() => {
  // No window: not a browser context, nothing to attach to.
  if (typeof window === "undefined") return;
  // Idempotent: the init script can be evaluated more than once per webview, and re-building the API would
  // discard the live event listeners the existing one holds.
  if ((window as any).Liatir) return;

  console.log("[Liatir bridge] init script evaluated");

  const core = buildCore();

  const api: LiatirBrowserAPI = {
    get isAvailable() { return true; },
    apiVersion: API_VERSION,
    get ready() { return core.ready; },
    invoke: core.invoke,
    isDesktop: true,

    desktop: {
      notifications:   buildNotifications(core),
      clipboard:       buildClipboard(core),
      files:           buildFiles(core),
      app:             buildAppInfo(core),
      window:          buildWindow(core),
      events:          buildEvents(core),
      globalShortcut:  buildShortcuts(core),
      fs:              buildFs(core),
      menu:            buildMenu(core),
      diagnostics:     buildDiagnostics(core),
      network:         buildNetwork(core),
      autostart:       buildAutostart(core),
      badge:           buildBadge(core),
      contextMenu:     buildContextMenu(core),
      globalVariables: buildGlobVar(core),
      mcp:             buildMcp(core),
    },

    jobs:     buildJobs(core),
    deps:     buildDeps(core),
    externalWorkflows: buildExternalWorkflows(core),

    qc:       buildQc(core),

    tauri:       windowTauriProxy as WindowTauri,
    onReady:     liaReadyEventListener,
    openBrowser: (url: string): Promise<void> => window.__TAURI__?.shell?.open(url),
    // Same call, different intent: `shell.open` hands a directory to the platform's file manager
    // exactly as it hands a URL to the browser. Named apart so a caller revealing a run's folder
    // does not have to read like it is opening a web page.
    openPath: (path: string): Promise<void> => window.__TAURI__?.shell?.open(path),
  };

  // Locked down on purpose — see the note at the top of the file. `enumerable: false` also keeps it out of
  // `Object.keys(window)` and out of anything that enumerates globals.
  Object.defineProperty(window, "Liatir", {
    value: api,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  console.log("[Liatir bridge] window.Liatir assigned", (window as any).Liatir);
})();

// The API object is created synchronously above so `window.Liatir` exists from the first line of page code —
// but Tauri's own runtime may not be ready yet. This second block waits for it, then runs the initialisers
// that need a live connection (event listeners, deep links, and so on). Any call made before that point still
// works: `core.invoke` awaits readiness itself.
(async () => {
  await waitTauri();

  if (tauriReadyCheck()) {
    liaInitiators();
  } else {
    // Outside the desktop app (a plain browser during development) Tauri is *expected* to be absent, so the
    // timeout is not an error worth reporting.
    if(!isBrowser()) return;
    console.error("[Liatir bridge] Tauri did not become ready in time");
  }
})();
