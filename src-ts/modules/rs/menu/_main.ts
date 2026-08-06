/**
 * `Liatir.desktop.menu` — the native application menu.
 *
 * Built declaratively from a config object (or a JSON file), rather than item by item, so a menu is data the
 * app can inspect and modify. `setEnabled`/`setChecked` then toggle individual items by id at runtime.
 */
import { initMenuConfig } from "../../../helpers";
import type { LiatirAPI, MenuConfig, MenuInterface, } from "../../../types";

export function buildMenu(core: { invoke: LiatirAPI["invoke"] }): MenuInterface {
  return {
    setEnabled: (id: string, enabled: boolean): Promise<void> => core.invoke("lia_menu_set_enabled", { id, enabled }),
    setChecked: (id: string, checked: boolean): Promise<void> => core.invoke("lia_menu_set_checked", { id, checked }),
    init: {
      fromConfig: (config: MenuConfig, windowLabel?: string): Promise<void> => initMenuConfig(core, config, windowLabel),
      fromJsonFile: (filePath: string): Promise<void> => core.invoke("lia_init_menu_from_file", { filePath })
    }
  };
}
