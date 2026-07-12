/**
 * `Liatir.desktop.globalShortcut` — OS-wide keyboard shortcuts, active even when Liatir is not focused.
 *
 * The callback always fires. `emitEvent` additionally re-broadcasts the shortcut as a Liatir event, which is
 * what lets a part of the app that did not register the shortcut still react to it.
 */
import { tauriGlobalShortcut } from "../../../helpers";
import { ShortcutsInterface } from "../../../types";

export function buildShortcuts(core: { invoke: <T=unknown>(cmd: string, payload?: any)=>Promise<T> }): ShortcutsInterface {
  return {
    register: async (accelerator: string, cb: (e: any) => void, options?: { emitEvent?: boolean }) => {
      const gs = tauriGlobalShortcut();
      await gs.register(accelerator, async (e: any) => {
        const payload = { accelerator, ...e };
        if (options?.emitEvent) await core.invoke("lia_event_emit", { event: "shortcut:event", payload });
        cb(payload);
      });
    },
    unregister: async (accelerator: string) => {
      const gs = tauriGlobalShortcut();
      const reg = await gs.isRegistered(accelerator);
      if (reg) await gs.unregister(accelerator);
    },
    unregisterAll: async () => {
      const gs = tauriGlobalShortcut();
      await gs.unregisterAll();
    },
    isRegistered: async (accelerator: string) => {
      const gs = tauriGlobalShortcut();
      return gs.isRegistered(accelerator);
    },
  };
}
