/**
 * `Liatir.desktop.app` — app metadata (version, OS) and a clean exit.
 */
import { AppInfo, AppInterface, LiatirAPI } from "../../../types";
import { I32 } from "../../../utils";

export function buildAppInfo(core: { invoke: LiatirAPI["invoke"] }): AppInterface {
    return {
      info: (): Promise<AppInfo> => core.invoke("lia_app_info"),
      exit: (code?: I32): Promise<void> => core.invoke("lia_app_exit", {code: code??0})
    };
  }
  