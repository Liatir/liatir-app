import { DesktoprAPI } from "../../../types";
import { U64, U8 } from "../../../utils";
import { PluginsInterface, PluginCallPayload, PluginStatusResult, PluginCallResult, PluginAddResult } from "./_types";
import { normalizeModuleName } from "./_helpers";

export function buildPlugins(core: { invoke: DesktoprAPI["invoke"] }): PluginsInterface {
    return {
      call: (module: string, payload: PluginCallPayload, timeoutMs?: U64): Promise<PluginCallResult> => core.invoke("dtr_plugin_call", {module: normalizeModuleName(module), payload, timeoutMs}),
      status: (): Promise<PluginStatusResult> => core.invoke("dtr_plugin_status"),
      list: (): Promise<string[]> => core.invoke("dtr_plugin_list_modules"),
      remove: (name: string): Promise<boolean> => core.invoke("dtr_plugin_remove_module", {name: normalizeModuleName(name)}),
      addFromBytes: (name: string, contents: U8[]): Promise<any> => core.invoke("dtr_plugin_add_module", {name: normalizeModuleName(name), contents}),
      add: (name: string, maxBytes?: U64): Promise<PluginAddResult> => core.invoke("dtr_plugin_pick_and_add_module", {maxBytes, defaultName: normalizeModuleName(name)}),
      killJobs: (): Promise<boolean> => core.invoke("dtr_plugin_clear_all_jobs")
    };
  }
  