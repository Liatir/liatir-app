/**
 * `Liatir.desktop.app` — app metadata (version, OS) and a clean exit.
 */
import { AppInfo, AppInterface, AppUpdateCheckResult, AppUpdateInstallResult, LiatirAPI } from "../../../types";
import { I32 } from "../../../utils";

export function buildAppInfo(core: { invoke: LiatirAPI["invoke"] }): AppInterface {
    return {
      info: (): Promise<AppInfo> => core.invoke("lia_app_info"),
      exit: (code?: I32): Promise<void> => core.invoke("lia_app_exit", {code: code??0}),
      updates: {
        check: (): Promise<AppUpdateCheckResult> => core.invoke("lia_app_update_check"),
        install: (): Promise<AppUpdateInstallResult> => core.invoke("lia_app_update_install"),
        restart: (): Promise<void> => core.invoke("lia_app_restart"),
      },
    };
  }
