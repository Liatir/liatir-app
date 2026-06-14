import type { OfflabAPI, WindowTauri } from "./types";
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
    dtrInitiators,
    buildDiagnostics,
    buildNetwork,
    buildAutostart,
    buildBadge,
    buildContextMenu,
    // buildCompanion,
    buildGlobVar,
    dtrReadyEventListener,
} from "./main";
import { API_VERSION } from "./constants";
import { windowTauriProxy, tauriReadyCheck, waitTauri } from "./helpers";
import { buildPlugins } from "./modules/rs/plugins/_main";

(() => {
  if (typeof window === "undefined") return;
  if ((window as any).Offlab) return;

  console.log("[Offlab bridge] init script evaluated");

  const core = buildCore();

  const api: OfflabAPI = {
    get isAvailable() { return true; },
    apiVersion: API_VERSION,
    get ready() {
      return core.ready;
    },
    invoke: core.invoke,
    isDesktop: true,
    notifications:    buildNotifications(core),
    clipboard:        buildClipboard(core),
    files:            buildFiles(core),
    app:              buildAppInfo(core),
    window:           buildWindow(core),
    events:           buildEvents(core),
    globalShortcut:   buildShortcuts(core),
    fs:               buildFs(core),
    menu:             buildMenu(core),
    diagnostics:      buildDiagnostics(core),
    network:          buildNetwork(core),
    autostart:        buildAutostart(core),
    badge:            buildBadge(core),
    plugins:          buildPlugins(core),
    contextMenu:      buildContextMenu(core),
    globalVariables:  buildGlobVar(core),
    tauri:            windowTauriProxy as WindowTauri,
    onReady:          dtrReadyEventListener,
    openBrowser: (url: string): Promise<void> => window.__TAURI__?.shell?.open(url)
  };

  Object.defineProperty(window, "Offlab", {
    value: api,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  console.log("[Offlab bridge] window.Offlab assigned", (window as any).Offlab);
})();

(async () => {
  await waitTauri();

  if (tauriReadyCheck()) {
    dtrInitiators();
  } else {
    console.error("[Offlab bridge] Tauri did not become ready in time");
  }
})();