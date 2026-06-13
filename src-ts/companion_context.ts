// Comments are in English

import { COMAPNION_WINDOW_LABEL_PREFIX } from "./constants";
import { WindowInfo } from "./types";

export type CompanionState = {
  isCacheOnly?: boolean;
  sessionId?: string;
  windowLabel?: string;
};

let state: CompanionState = {
  isCacheOnly: false,
};

function parseCompanionWindowLabel(label: string): CompanionState {
        const prefix = COMAPNION_WINDOW_LABEL_PREFIX.trim();
        if (!label.startsWith(prefix)) {
            return { isCacheOnly: false };
        }
        const sessionId = label.slice(prefix.length);
        if (!sessionId) {
            return { isCacheOnly: false, windowLabel: label };
        }
        return { isCacheOnly: true, sessionId, windowLabel: label };
    }

let initialized = false;

export async function getCacheOnlyWindowContext(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (typeof window === "undefined" || !window?.Desktopr) {
    console.error("Error executing setupCompanionContext():\nwindow.Desktopr undefined or not yet initialized.");
    return;
  }

  try {
    const windowInfo: WindowInfo = await window.Desktopr.window.getInfo();
    const compState = parseCompanionWindowLabel(windowInfo.label);

    state = compState;

    window.Desktopr.window.state = compState;
    // if (window?.Desktopr?.companion?.state) window.Desktopr.companion.state = compState;
  } catch (error) {
    console.warn("[Desktopr bridge] Failed to initialize cache-only window context:", error);
  }
}

// Simple getters

export function isCacheOnlyWindow(): boolean {
  return (state?.isCacheOnly) ?? false;
}

export function getCacheOnlyWindowLabel(): string | undefined {
  return state?.windowLabel;
}

export function getCacheOnlySessionId(): string | undefined {
  return state?.sessionId;
}