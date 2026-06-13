import { initMenuConfig } from "../../../helpers";
import type { DesktoprAPI, MenuConfig, MenuInterface, } from "../../../types";

export function buildMenu(core: { invoke: DesktoprAPI["invoke"] }): MenuInterface {
  return {
    setEnabled: (id: string, enabled: boolean): Promise<void> => core.invoke("dtr_menu_set_enabled", { id, enabled }),
    setChecked: (id: string, checked: boolean): Promise<void> => core.invoke("dtr_menu_set_checked", { id, checked }),
    init: {
      fromConfig: (config: MenuConfig, windowLabel?: string): Promise<void> => initMenuConfig(core, config, windowLabel),
      fromJsonFile: (filePath: string): Promise<void> => core.invoke("dtr_init_menu_from_file", { filePath })
    }
  };
}
