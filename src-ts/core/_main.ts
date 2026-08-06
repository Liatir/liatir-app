/**
 * The core of the bridge: the single path from JavaScript to Rust.
 *
 * Every `buildX(core)` factory calls Rust through this `invoke`, so there is exactly one place that knows how
 * to reach Tauri — and exactly one place that handles it not being ready yet.
 *
 * `ensureCore()` is awaited on *every* call rather than once at startup. That is what makes the API usable
 * from the first line of page code: a caller invoking a command before Tauri has finished initialising simply
 * waits, instead of getting an error or a silently dropped call.
 */
import { ensureCore } from "../helpers";
import type { TauriCore } from "../types";

export function buildCore() {
  return {
    /** Resolves once the bridge can actually talk to Rust. */
    get ready() {
      return ensureCore().then(() => true as const);
    },
    async invoke<T = unknown>(cmd: string, payload?: Record<string, unknown>) {
      const core: TauriCore = await ensureCore();
      return core.invoke<T>(cmd, payload);
    },
  };
}
