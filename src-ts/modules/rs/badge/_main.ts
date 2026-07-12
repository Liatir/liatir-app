/**
 * `Liatir.desktop.badge` — the count badge on the app's dock/taskbar icon.
 *
 * Platform-specific: the calls go through `platformSpecifcFilter`, so on a platform without badges the caller
 * gets a clear error naming the platform rather than a silent no-op.
 */
import { platformSpecifcFilter } from "../../../helpers";
import { AppInfo, BadgeInterface, LiatirAPI } from "../../../types";
import { U32 } from "../../../utils";

export function buildBadge(core: { invoke: LiatirAPI["invoke"] }): BadgeInterface {
    return {
      set: async (count: U32): Promise<void> => {
        await platformSpecifcFilter(["macos"]);
        core.invoke("lia_badge_set", {count});
      },
      clear: async (): Promise<void> => {
        await platformSpecifcFilter(["macos"]);
        core.invoke("lia_badge_clear");
      },
    };
  }
  