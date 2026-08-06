/**
 * `Liatir.desktop.window` — window management.
 *
 * Every method defaults to the `main` window, so the common case needs no label. A label is only required
 * when the app has opened additional windows (a standalone Quenta window, for instance).
 */
import type { LiatirAPI, NewWindowOptions, WindowInfo, WindowInterface } from "../../../types";
import { closeWindow, newWindow } from "./_helpers";

export function buildWindow(core: { invoke: LiatirAPI["invoke"] }): WindowInterface {
  const randomWindowLabel: string = `w_${Math.random().toString(36).substring(2, 2 + 8)}`
  return {
    minimize: (label?: string): Promise<void> => core.invoke("lia_win_minimize", { label: label??"main" }),
    maximizeToggle: (label?: string): Promise<void> => core.invoke("lia_win_maximize", { label: label??"main" }),
    fullscreen: (enable: boolean, label?: string): Promise<void> => core.invoke("lia_win_fullscreen", { enable, label: label??"main" }),
    new: async (options?: NewWindowOptions): Promise<void> => newWindow(core, options),
    close: (label: string): Promise<void> => closeWindow(core, label),
    getInfo: (label?: string): Promise<WindowInfo> => core.invoke("lia_win_get_info", { label }),
  };
}
