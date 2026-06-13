import { DesktoprAPI } from "../../../types";
import { listenForEvent } from "../../../helpers";
import type { DragDropPayload, EventsInterface } from "../../../types";

export function buildEvents(core: { invoke: DesktoprAPI["invoke"] }): EventsInterface {
  return {
    emit: (event: string, payload?: unknown) => core.invoke("dtr_event_emit_to_current_window", { event, payload }),
    emitToAll: (event: string, payload?: unknown) => core.invoke("dtr_event_emit", { event, payload }),
    emitTo: (windowLabel: string, event: string, payload?: unknown) =>
      core.invoke("dtr_event_emit_to", { windowLabel, event, payload }),

    on: async (event: string, handler: (payload: any) => void) => listenForEvent(event, handler),

    once: (event: string) =>
      new Promise<any>(async (resolve) => {
        const off = await listenForEvent(event, (p) => {
          off();
          resolve(p);
        });
      }),

    onMany: async (events: string[], handler: (name: string, payload: any) => void) => {
      const offs = await Promise.all(events.map((n) => listenForEvent(n, (p) => handler(n, p))));
      return () => offs.forEach((off) => off());
    },

    onNetworkStatus: async (handler: (payload: any) => void) => listenForEvent("network:status", handler),

    onDeeplink: async (handler: (payload: any) => void) => listenForEvent("deeplink", handler),

    onShortcut: async (handler: (payload: any) => void) => listenForEvent("shortcut:event", handler),

    onDragDrop: async (
      handler: (name: string, payload: DragDropPayload) => void,
      options?: { includeHover?: boolean }
    ) => {
      const evs = ["dragdrop:enter", "dragdrop:drop", "dragdrop:cancel"];
      if (options?.includeHover) evs.push("dragdrop:hover");
      const offs = await Promise.all(evs.map((n) => listenForEvent(n, (p) => handler(n, p))));
      return () => offs.forEach((off) => off());
    },
    
    onMenuEvent: async (handler: (payload: any) => void) => listenForEvent("menu:event", handler),
    onTrayIconEvent: async (handler: (payload: any) => void) => listenForEvent("tray:icon", handler)
  };
}
