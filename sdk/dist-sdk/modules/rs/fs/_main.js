"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFs = buildFs;
const helpers_1 = require("../../../helpers");
const getWindowLabelIfCompanion = () => {
    const compState = window?.Desktopr?.window
        ?.state;
    let label = undefined;
    if (compState && compState?.windowLabel?.trim() && compState?.isCacheOnly)
        label = compState.windowLabel.trim();
    return label;
};
// Comments are in English
function scopeCoreMethods(core, permanent, plugin) {
    // Guard that prevents persistent data operations from isolated (companion) windows.
    const ensureDataNotIsolated = () => {
        if (!permanent)
            return;
        const label = getWindowLabelIfCompanion();
        if (label && label.trim().length > 0) {
            throw new Error("Persistent data operations are not available in isolated companion windows. Use the cache scope (Desktopr.fs.cache) for per-session storage.");
        }
    };
    const pluginStorageModule = ((plugin?.trim()) ?? undefined);
    return {
        listContent: (rel = "") => {
            ensureDataNotIsolated();
            return core.invoke("dtr_fs_list_dir", {
                rel,
                permanent,
                windowLabel: getWindowLabelIfCompanion(),
                pluginStorageModule
            });
        },
        newDirectory: (rel) => {
            ensureDataNotIsolated();
            return core.invoke("dtr_fs_mkdir", {
                rel,
                permanent,
                windowLabel: getWindowLabelIfCompanion(),
                pluginStorageModule
            });
        },
        remove: (rel, recursive = false) => {
            ensureDataNotIsolated();
            return core.invoke("dtr_fs_rm", {
                rel,
                recursive,
                permanent,
                windowLabel: getWindowLabelIfCompanion(),
                pluginStorageModule
            });
        },
        stat: (rel = "") => {
            ensureDataNotIsolated();
            return core.invoke("dtr_fs_stat", {
                rel,
                permanent,
                windowLabel: getWindowLabelIfCompanion(),
                pluginStorageModule
            });
        },
        writeText: (rel, contents, opts) => {
            ensureDataNotIsolated();
            return core.invoke("dtr_fs_write_text", {
                rel,
                permanent,
                contents,
                createDirs: opts?.createDirs,
                append: opts?.append,
                windowLabel: getWindowLabelIfCompanion(),
                pluginStorageModule
            });
        },
        readText: (rel) => {
            ensureDataNotIsolated();
            return core.invoke("dtr_fs_read_text", {
                rel,
                permanent,
                windowLabel: getWindowLabelIfCompanion(),
                pluginStorageModule
            });
        },
        writeBytes: (rel, base64, opts) => {
            ensureDataNotIsolated();
            return core.invoke("dtr_fs_write_bytes", {
                rel,
                permanent,
                dataBase64: base64,
                createDirs: opts?.createDirs,
                windowLabel: getWindowLabelIfCompanion(),
                pluginStorageModule
            });
        },
        readBytes: (rel) => {
            ensureDataNotIsolated();
            return core.invoke("dtr_fs_read_bytes", {
                rel,
                permanent,
                windowLabel: getWindowLabelIfCompanion(),
                pluginStorageModule
            });
        },
        exists: (rel) => {
            ensureDataNotIsolated();
            return core.invoke("dtr_fs_exists", {
                rel,
                permanent,
                windowLabel: getWindowLabelIfCompanion(),
                pluginStorageModule
            });
        },
        move: (src, dest, opts) => {
            ensureDataNotIsolated();
            return core.invoke("dtr_fs_move", {
                src,
                dest,
                permanent,
                createDirs: opts?.createDirs,
                overwrite: opts?.overwrite,
                windowLabel: getWindowLabelIfCompanion(),
                pluginStorageModule
            });
        },
        copy: (src, dest, opts) => {
            ensureDataNotIsolated();
            return core.invoke("dtr_fs_copy", {
                src,
                dest,
                permanent,
                recursive: opts?.recursive,
                createDirs: opts?.createDirs,
                overwrite: opts?.overwrite,
                windowLabel: getWindowLabelIfCompanion(),
                pluginStorageModule
            });
        },
    };
}
;
// Comments are in English
function scope(core, permanent) {
    // Guard that prevents persistent data operations from isolated (companion) windows.
    const ensureDataNotIsolated = () => {
        if (!permanent)
            return;
        const label = getWindowLabelIfCompanion();
        if (label && label.trim().length > 0) {
            throw new Error("Persistent data operations are not available in isolated companion windows. Use the cache scope (Desktopr.fs.cache) for per-session storage.");
        }
    };
    const coreMethods = scopeCoreMethods(core, permanent);
    const mainScopeMethods = {
        ...coreMethods,
        path: async () => {
            ensureDataNotIsolated();
            const p = await core.invoke("dtr_fs_paths");
            return permanent ? p.data : p.cache;
        },
        clear: async () => {
            ensureDataNotIsolated();
            if (permanent) {
                return core.invoke("dtr_fs_clear_data");
            }
            return core.invoke("dtr_fs_clear_cache");
        },
        base: permanent ? ".data" : ".cache",
    };
    return mainScopeMethods;
}
function pluginFsScope(core, plugin) {
    const pluginModuleName = ((plugin?.trim()) ?? undefined);
    const santizedluginModuleName = ((0, helpers_1.normalizeModuleName)(pluginModuleName)?.trim()) ?? undefined;
    if (!santizedluginModuleName)
        throw ("Invalid plugin name");
    const coreMethods = scopeCoreMethods(core, true, santizedluginModuleName);
    return {
        ...coreMethods,
        clearStorage: async () => core.invoke("dtr_plugin_storage_clear", { module: santizedluginModuleName })
    };
}
function buildFs(core) {
    const cache = scope(core, false);
    const data = scope(core, true);
    return {
        cache,
        data,
        pluginFs: (plugin) => pluginFsScope(core, plugin),
        paths: async () => core.invoke("dtr_fs_paths"),
        base: { cache: ".cache", data: ".data" },
        trash: {
            clear: async () => core.invoke("dtr_fs_data_clear_trash"),
            recover: async () => core.invoke("dtr_fs_data_recover_trash"),
            listContent: async (rel = "") => core.invoke("dtr_fs_trash_list_dir", { rel }),
            stat: async (rel = "") => core.invoke("dtr_fs_trash_stat", { rel }),
            exists: async (rel = "") => core.invoke("dtr_fs_trash_exists", { rel }),
            readText: async (rel) => core.invoke("dtr_fs_trash_read_text", { rel }),
            readBytes: async (rel) => core.invoke("dtr_fs_trash_read_bytes", { rel }),
        },
        diagnostics: {
            clear: async () => core.invoke("dtr_fs_diagnostics_clear"),
            remove: async (rel, recursive = false) => core.invoke("dtr_fs_diagnostics_rm", { rel, recursive }),
            listContent: async (rel = "") => core.invoke("dtr_fs_diagnostics_list_dir", { rel }),
            stat: async (rel = "") => core.invoke("dtr_fs_diagnostics_stat", { rel }),
            exists: async (rel = "") => core.invoke("dtr_fs_diagnostics_exists", { rel }),
            readText: async (rel) => core.invoke("dtr_fs_diagnostics_read_text", { rel }),
            readBytes: async (rel) => core.invoke("dtr_fs_diagnostics_read_bytes", { rel }),
        },
    };
}
