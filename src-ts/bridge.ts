import type { LiatirAPI, WindowTauri } from "./types";
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
import { buildPlugins } from "./modules/rs/plugins/_main";
import { buildSidecar } from "./modules/rs/sidecar/_main";
import { buildPipeline } from "./modules/bio/pipeline/_main";
import { buildJobs } from "./modules/rs/jobs/_main";
import { buildDeps } from "./modules/rs/deps/_main";
import { buildQc } from "./modules/qc/_main";

(() => {
  if (typeof window === "undefined") return;
  if ((window as any).Liatir) return;

  console.log("[Liatir bridge] init script evaluated");

  const core = buildCore();
  const plugins = buildPlugins(core);
  const sidecar = buildSidecar(core);

  const api: LiatirAPI = {
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

    plugins,
    sidecar,
    pipeline: buildPipeline({ plugins, sidecar }),

    jobs:     buildJobs(core),
    deps:     buildDeps(core),

    qc:       buildQc({ plugins }),

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
    console.error("[Liatir bridge] Tauri did not become ready in time");
  }
})();
