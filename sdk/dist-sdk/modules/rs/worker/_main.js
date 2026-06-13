"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWorker = buildWorker;
const helpers_1 = require("../../../helpers");
function buildWorker(core) {
    return {
        call: (method, payload, timeoutMs) => core.invoke("dtr_worker_call", { modulePath: (0, helpers_1.normalizeModuleName)(method), payload, timeoutMs }),
        status: () => core.invoke("dtr_worker_status"),
        restart: () => core.invoke("dtr_worker_restart"),
        // delivery: (id: string, result: string): Promise<boolean> => core.invoke("dtr_worker_delivery", {id, result}),
        modules: {
            list: () => core.invoke("dtr_worker_list_modules"),
            remove: (name) => core.invoke("dtr_worker_remove_module", { name: (0, helpers_1.normalizeModuleName)(name) }),
            addFromBytes: (name, contents) => core.invoke("dtr_worker_add_module", { name: (0, helpers_1.normalizeModuleName)(name), contents }),
            add: (name, maxBytes) => core.invoke("dtr_worker_pick_and_add_module", { maxBytes, defaultName: (0, helpers_1.normalizeModuleName)(name) }),
        },
        clearSandbox: () => core.invoke("dtr_worker_clear_all"),
        paths: () => core.invoke("dtr_worker_paths"),
    };
}
