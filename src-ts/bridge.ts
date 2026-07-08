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
import { buildQc } from "./modules/qc/_main";
import { isBrowser } from "./utils";

(() => {
  if (typeof window === "undefined") return;
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
    },

    jobs:     buildJobs(core),
    deps:     buildDeps(core),

    qc:       buildQc(core),

    tauri:       windowTauriProxy as WindowTauri,
    onReady:     liaReadyEventListener,
    openBrowser: (url: string): Promise<void> => window.__TAURI__?.shell?.open(url),
  };

  Object.defineProperty(window, "Liatir", {
    value: api,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  console.log("[Liatir bridge] window.Liatir assigned", (window as any).Liatir);
})();

(async () => {
  await waitTauri();

  if (tauriReadyCheck()) {
    liaInitiators();
  } else {
    if(!isBrowser()) return;
    console.error("[Liatir bridge] Tauri did not become ready in time");
  }
})();
