// src-ts/sdk/offlab.ts
import type { OfflabAPI } from "../types";

function getWindow(): Window {
  if (typeof window === "undefined") {
    throw new Error("[Offlab] window is not defined. Are you running in SSR?");
  }
  return window;
}

function getGlobalBridge(): OfflabAPI | undefined {
  const w = getWindow() as any;
  const bridge = w.Offlab;

  if (!bridge) {
    console.error(
      "[Offlab] window.Offlab is not available. Is the desktop wrapper loaded?"
    );
    return;
  }

  return bridge as OfflabAPI;
}

export function isOfflabAvailable(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const w = window as any;
  return !!w.Offlab;
}

export const Offlab: OfflabAPI = new Proxy({} as OfflabAPI, {
  get(_target, prop, _receiver) {
    const bridge = getGlobalBridge() ?? undefined;
    const value = (bridge as any)[prop];

    if (typeof value === "function") {
      return value.bind(bridge);
    }

    return value;
  },

  set(_target, prop, value) {
    const bridge = getGlobalBridge() ?? undefined;
    (bridge as any)[prop] = value;
    return true;
  }
});
