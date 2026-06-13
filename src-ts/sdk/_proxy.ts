// src-ts/sdk/desktopr.ts
import type { DesktoprAPI } from "../types";

// Internal helper: get a safe window reference
function getWindow(): Window {
  if (typeof window === "undefined") {
    // Avoid using the bridge in SSR or in non-browser environments
    throw new Error("[Desktopr] window is not defined. Are you running in SSR?");
  }
  return window;
}

// Internal helper: access the real global bridge
function getGlobalBridge(): DesktoprAPI | undefined {
  const w = getWindow() as any;
  const bridge = w.Desktopr;

  if (!bridge) {
    // Desktopr bridge is not yet injected by the wrapper
    console.error(
      "[Desktopr] window.Desktopr is not available. Is the desktop wrapper loaded?"
    );
    return;
  }

  return bridge as DesktoprAPI;
}

// Public helper to check if the native Desktopr bridge is available.
// This must never throw, even in SSR or when running outside the wrapper.
export function isDesktoprAvailable(): boolean {
  if (typeof window === "undefined") {
    // In SSR or non-browser environments the bridge is not available.
    return false;
  }

  const w = window as any;
  return !!w.Desktopr;
}

// Public SDK object.
// At runtime, this is just a Proxy that forwards everything to window.Desktopr,
// but from the developer point of view it is strongly typed as DesktoprAPI.
export const Desktopr: DesktoprAPI = new Proxy({} as DesktoprAPI, {
  get(_target, prop, _receiver) {
    const bridge = getGlobalBridge() ?? undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (bridge as any)[prop];

    // If the property is a function, bind it to the original object
    if (typeof value === "function") {
      return value.bind(bridge);
    }

    return value;
  },

  set(_target, prop, value) {
    const bridge = getGlobalBridge() ?? undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bridge as any)[prop] = value;
    return true;
  }
});