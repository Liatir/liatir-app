import { launchCompanion } from "../companion/_helpers";
import type { DesktoprAPI, NewWindowOptions, WindowInfo, WindowInterface } from "../../../types";
import { closeWindow, newWindow } from "./_helpers";

export function buildWindow(core: { invoke: DesktoprAPI["invoke"] }): WindowInterface {
  const randomWindowLabel: string = `w_${Math.random().toString(36).substring(2, 2 + 8)}`
  return {
    minimize: (label?: string): Promise<void> => core.invoke("dtr_win_minimize", { label: label??"main" }),
    maximizeToggle: (label?: string): Promise<void> => core.invoke("dtr_win_maximize", { label: label??"main" }),
    fullscreen: (enable: boolean, label?: string): Promise<void> => core.invoke("dtr_win_fullscreen", { enable, label: label??"main" }),
    new: async (options?: NewWindowOptions): Promise<void> => {
      if(options?.cacheOnly) launchCompanion(core,{
        title: options?.label,
        url: options?.url,
        openFullscreen: options?.fullscreen
      });
      else newWindow(core, options);
    },
    close: (label: string): Promise<void> => closeWindow(core, label),
    getInfo: (label?: string): Promise<WindowInfo> => core.invoke("dtr_win_get_info", { label }),
    state: {}
  };
}
