import { AppInfo, AppInterface, DesktoprAPI } from "../../../types";
import { I32 } from "../../../utils";

export function buildAppInfo(core: { invoke: DesktoprAPI["invoke"] }): AppInterface {
    return {
      info: (): Promise<AppInfo> => core.invoke("dtr_app_info"),
      exit: (code?: I32): Promise<void> => core.invoke("dtr_app_exit", {code: code??0})
    };
  }
  