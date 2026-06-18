import type { LiatirAPI, } from "../../../types";
import { AutostartInterface, AutostartMode } from "./_types";

export function buildAutostart(core: { invoke: LiatirAPI["invoke"] }): AutostartInterface {
  return {
    enable: (): Promise<void> => core.invoke("lia_autostart_enable"),
    disable: (): Promise<void> => core.invoke("lia_autostart_disable"),
    isEnabled: (): Promise<void> => core.invoke("lia_autostart_status"),
    mode: {
      get: (): Promise<void> => core.invoke("lia_get_autostart_mode"),
      set: (mode: AutostartMode): Promise<void> => core.invoke("lia_set_autostart_mode", {mode}),
    }
  };
}