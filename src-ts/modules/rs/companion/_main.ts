import { launchCompanion } from "../../../helpers";
import type { DesktoprAPI, CompanionConfig, CompanionInterface } from "../../../types";

export function buildCompanion(core: { invoke: DesktoprAPI["invoke"] }): CompanionInterface {
  return {
    launch: (appConfig?: CompanionConfig): Promise<void> => launchCompanion(core, appConfig),
    state: {}
  };
}
