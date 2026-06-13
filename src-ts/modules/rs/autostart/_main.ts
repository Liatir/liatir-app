import type { DesktoprAPI, } from "../../../types";
import { AutostartInterface, AutostartMode } from "./_types";

export function buildAutostart(core: { invoke: DesktoprAPI["invoke"] }): AutostartInterface {
  return {
    enable: (): Promise<void> => core.invoke("dtr_autostart_enable"),
    disable: (): Promise<void> => core.invoke("dtr_autostart_disable"),
    isEnabled: (): Promise<void> => core.invoke("dtr_autostart_status"),
    mode: {
      get: (): Promise<void> => core.invoke("dtr_get_autostart_mode"),
      set: (mode: AutostartMode): Promise<void> => core.invoke("dtr_set_autostart_mode", {mode}),
    }
  };
}