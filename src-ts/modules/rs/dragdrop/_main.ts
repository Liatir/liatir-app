/**
 * Drag-and-drop payload plumbing. The subscription itself is exposed through
 * `Liatir.desktop.events.onDragDrop`, which subscribes to the whole enter/drop/cancel sequence at once.
 */


import { DragDropPayload } from "../../../types";
import { listenForEvent } from "../../../helpers";

// Puoi esportare qui un builder che semplicemente re-esporta quella logica.
export function buildDragDrop() {
  return {
    on: async (
      handler: (name: string, payload: DragDropPayload) => void,
      options?: { includeHover?: boolean }
    ) => {
      const evs = ["dragdrop:enter", "dragdrop:drop", "dragdrop:cancel"];
      if (options?.includeHover) evs.push("dragdrop:hover");
      const offs = await Promise.all(evs.map((n) => listenForEvent(n, (p) => handler(n, p))));
      return () => offs.forEach((off) => off());
    },
  };
}
