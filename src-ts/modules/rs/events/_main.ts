/**
 * `Liatir.desktop.events` — sending and receiving events across the app.
 *
 * This is how the backend pushes things that are not a response to a call: download progress, job output, drag
 * and drop, deep links. Every subscriber gets back an *unsubscribe* function, and the composite subscriptions
 * below (`onMany`, `onDragDrop`) return one that detaches all of their listeners at once — so a caller never
 * has to track several handles to clean up one logical subscription.
 */
import { LiatirAPI } from "../../../types";
import { listenForEvent } from "../../../helpers";
import type { DragDropPayload, EventsInterface } from "../../../types";

export function buildEvents(core: { invoke: LiatirAPI["invoke"] }): EventsInterface {
  return {
    // Three emit scopes: this window, every window, or one named window.
    emit: (event: string, payload?: unknown) => core.invoke("lia_event_emit_to_current_window", { event, payload }),
    emitToAll: (event: string, payload?: unknown) => core.invoke("lia_event_emit", { event, payload }),
    emitTo: (windowLabel: string, event: string, payload?: unknown) =>
      core.invoke("lia_event_emit_to", { windowLabel, event, payload }),

    on: async (event: string, handler: (payload: any) => void) => listenForEvent(event, handler),

    // Resolves on the first occurrence and unsubscribes itself, so a one-shot listener cannot leak.
    once: (event: string) =>
      new Promise<any>(async (resolve) => {
        const off = await listenForEvent(event, (p) => {
          off();
          resolve(p);
        });
      }),

    // One handler across several events; the returned function detaches them all.
    onMany: async (events: string[], handler: (name: string, payload: any) => void) => {
      const offs = await Promise.all(events.map((n) => listenForEvent(n, (p) => handler(n, p))));
      return () => offs.forEach((off) => off());
    },

    onNetworkStatus: async (handler: (payload: any) => void) => listenForEvent("network:status", handler),

    onDeeplink: async (handler: (payload: any) => void) => listenForEvent("deeplink", handler),

    onShortcut: async (handler: (payload: any) => void) => listenForEvent("shortcut:event", handler),

    /**
     * A drag-and-drop is not one event but a sequence (enter, drop, cancel), and a caller almost always wants
     * all of them — so they are subscribed together and torn down together.
     *
     * `hover` fires continuously while the cursor moves over the window, so it is opt-in: most callers only
     * care where a file was dropped, not about every pixel on the way there.
     */
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
