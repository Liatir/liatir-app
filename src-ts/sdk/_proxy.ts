// src-ts/sdk/liatir.ts
import type { LiatirAPI } from "../types";

function getWindow(): Window {
  if (typeof window === "undefined") {
    throw new Error("[Liatir] window is not defined. Are you running in SSR?");
  }
  return window;
}

function getGlobalBridge(): LiatirAPI | undefined {
  const w = getWindow() as any;
  const bridge = w.Liatir;

  if (!bridge) {
    console.error(
      "[Liatir] window.Liatir is not available. Is the desktop wrapper loaded?"
    );
    return;
  }

  return bridge as LiatirAPI;
}

export function isLiatirAvailable(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const w = window as any;
  return !!w.Liatir;
}

export const Liatir: LiatirAPI = new Proxy({} as LiatirAPI, {
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
