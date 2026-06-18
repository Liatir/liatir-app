import { LiatirAPI } from "../../../types";
import { U64, U8 } from "../../../utils";
import { PluginsInterface, PluginCallPayload, PluginStatusResult, PluginCallResult, PluginAddResult } from "./_types";
import { normalizeModuleName } from "./_helpers";

export function buildPlugins(core: { invoke: LiatirAPI["invoke"] }): PluginsInterface {
    return {
      call: (module: string, payload: PluginCallPayload, timeoutMs?: U64, hostReadPaths?: string[]): Promise<PluginCallResult> => core.invoke("lia_plugin_call", {module: normalizeModuleName(module), payload, timeoutMs, hostReadPaths}),
      status: (): Promise<PluginStatusResult> => core.invoke("lia_plugin_status"),
      list: (): Promise<string[]> => core.invoke("lia_plugin_list_modules"),
      remove: (name: string): Promise<boolean> => core.invoke("lia_plugin_remove_module", {name: normalizeModuleName(name)}),
      addFromBytes: (name: string, contents: U8[]): Promise<any> => core.invoke("lia_plugin_add_module", {name: normalizeModuleName(name), contents}),
      add: (name: string, maxBytes?: U64): Promise<PluginAddResult> => core.invoke("lia_plugin_pick_and_add_module", {maxBytes, defaultName: normalizeModuleName(name)}),
      killJobs: (): Promise<boolean> => core.invoke("lia_plugin_clear_all_jobs")
    };
  }
  