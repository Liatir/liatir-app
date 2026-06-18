import { platformSpecifcFilter } from "../../../helpers";
import { AppInfo, BadgeInterface, LiatirAPI } from "../../../types";
import { U32 } from "../../../utils";

export function buildBadge(core: { invoke: LiatirAPI["invoke"] }): BadgeInterface {
    return {
      set: async (count: U32): Promise<void> => {
        await platformSpecifcFilter(["macos"]);
        core.invoke("dtr_badge_set", {count});
      },
      clear: async (): Promise<void> => {
        await platformSpecifcFilter(["macos"]);
        core.invoke("dtr_badge_clear");
      },
    };
  }
  