import { ensureCore } from "../helpers";
import type { TauriCore } from "../types";

export function buildCore() {
  return {
    get ready() {
      return ensureCore().then(() => true as const);
    },
    async invoke<T = unknown>(cmd: string, payload?: Record<string, unknown>) {
      const core: TauriCore = await ensureCore();
      return core.invoke<T>(cmd, payload);
    },
  };
}
