/**
 * `Liatir.desktop.globalVariables` — a small persistent key/value store shared across the app.
 *
 * Used for values that must outlive a single run or window (the companion URL, for instance). Note that in the
 * plugin-dev sandbox these keys are namespaced, so a plugin under test cannot read or clobber the real app's
 * variables.
 */
import { LiatirAPI } from "../../../types";
import { GlobalVariablesAllowedTypes, GlobalVariablesInterface } from "./_types";

export function buildGlobVar(core: { invoke: LiatirAPI["invoke"] }): GlobalVariablesInterface {
    return {
      get: async (key: string): Promise<string> => core.invoke("lia_global_vars_get", {key}),
      set: async (key: string, value: GlobalVariablesAllowedTypes): Promise<void> => core.invoke("lia_global_vars_set", {key, value}),
      remove: async (key: string): Promise<void> => core.invoke("lia_global_vars_remove", {key}),
      list: async (): Promise<{[key: string]: string}> => core.invoke("lia_global_vars_list")
    };
  }
  