import { initContextMenuListener, normalizeEntries, removeContextMenuListener } from "../../../helpers";
import type { LiatirAPI, CmNode, CmPopupOptions, ContextMenuInterface } from "../../../types";

export function buildContextMenu(core: { invoke: LiatirAPI["invoke"] }): ContextMenuInterface {
  return {
    show: (entries: CmNode[], options: CmPopupOptions): Promise<string> => core.invoke("lia_context_menu_popup", { items: normalizeEntries(entries), options }),
    handler: {
      init: initContextMenuListener,
      remove: removeContextMenuListener
    }
  };
}
