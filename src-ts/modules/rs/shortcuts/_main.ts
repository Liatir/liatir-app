import { tauriGlobalShortcut } from "../../../helpers";
import { ShortcutsInterface } from "../../../types";

export function buildShortcuts(core: { invoke: <T=unknown>(cmd: string, payload?: any)=>Promise<T> }): ShortcutsInterface {
  return {
    register: async (accelerator: string, cb: (e: any) => void, options?: { emitEvent?: boolean }) => {
      const gs = tauriGlobalShortcut();
      await gs.register(accelerator, async (e: any) => {
        const payload = { accelerator, ...e };
        if (options?.emitEvent) await core.invoke("dtr_event_emit", { event: "shortcut:event", payload });
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
