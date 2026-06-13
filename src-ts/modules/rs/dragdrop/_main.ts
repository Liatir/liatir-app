

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
