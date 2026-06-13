"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlugins = buildPlugins;
const _helpers_1 = require("./_helpers");
function buildPlugins(core) {
    return {
        call: (module, payload, timeoutMs) => core.invoke("dtr_plugin_call", { module: (0, _helpers_1.normalizeModuleName)(module), payload, timeoutMs }),
        status: () => core.invoke("dtr_plugin_status"),
        list: () => core.invoke("dtr_plugin_list_modules"),
        remove: (name) => core.invoke("dtr_plugin_remove_module", { name: (0, _helpers_1.normalizeModuleName)(name) }),
        addFromBytes: (name, contents) => core.invoke("dtr_plugin_add_module", { name: (0, _helpers_1.normalizeModuleName)(name), contents }),
        add: (name, maxBytes) => core.invoke("dtr_plugin_pick_and_add_module", { maxBytes, defaultName: (0, _helpers_1.normalizeModuleName)(name) }),
        killJobs: () => core.invoke("dtr_plugin_clear_all_jobs")
    };
}
