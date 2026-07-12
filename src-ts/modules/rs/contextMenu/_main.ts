/**
 * `Liatir.desktop.contextMenu` — native right-click menus.
 *
 * Native rather than an HTML menu, so it looks and behaves like the rest of the OS, and can escape the bounds
 * of the window. The entries are normalised before being handed to Rust.
 */
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
