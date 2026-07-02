import { LiatirAPI } from "../../../types";
import { normalizePluginName } from "../plugins/_helpers";
import type {
    FsCoreMethods,
  FsEntry,
  FsInterface,
  FsPaths,
  FsPluginMethods,
  FsScopeMethods,
} from "../../../types";

// Comments are in English
function scopeCoreMethods(
  core: { invoke: LiatirAPI["invoke"] },
  permanent: boolean,
  plugin?: string
): FsCoreMethods {
  const ensureDataNotIsolated = () => {};

  const pluginStoragePlugin = ((plugin?.trim()) ?? undefined);

  return {
    listContent: (rel: string = "") => {
      ensureDataNotIsolated();
      return core.invoke<FsEntry[]>("lia_fs_list_dir", {
        rel,
        permanent,
        windowLabel: undefined,
        pluginStoragePlugin
      });
    },

    newDirectory: (rel: string) => {
      ensureDataNotIsolated();
      return core.invoke<void>("lia_fs_mkdir", {
        rel,
        permanent,
        windowLabel: undefined,
        pluginStoragePlugin
      });
    },

    remove: (rel: string, recursive = false) => {
      ensureDataNotIsolated();
      return core.invoke<void>("lia_fs_rm", {
        rel,
        recursive,
        permanent,
        windowLabel: undefined,
        pluginStoragePlugin
      });
    },

    stat: (rel: string = "") => {
      ensureDataNotIsolated();
      return core.invoke<FsEntry>("lia_fs_stat", {
        rel,
        permanent,
        windowLabel: undefined,
        pluginStoragePlugin
      });
    },

    writeText: (rel, contents, opts) => {
      ensureDataNotIsolated();
      return core.invoke<void>("lia_fs_write_text", {
        rel,
        permanent,
        contents,
        createDirs: opts?.createDirs,
        append: opts?.append,
        windowLabel: undefined,
        pluginStoragePlugin
      });
    },

    readText: (rel) => {
      ensureDataNotIsolated();
      return core.invoke<string>("lia_fs_read_text", {
        rel,
        permanent,
        windowLabel: undefined,
        pluginStoragePlugin
      });
    },

    writeBytes: (rel, base64, opts) => {
      ensureDataNotIsolated();
      return core.invoke<void>("lia_fs_write_bytes", {
        rel,
        permanent,
        dataBase64: base64,
        createDirs: opts?.createDirs,
        windowLabel: undefined,
        pluginStoragePlugin
      });
    },

    readBytes: (rel) => {
      ensureDataNotIsolated();
      return core.invoke<string>("lia_fs_read_bytes", {
        rel,
        permanent,
        windowLabel: undefined,
        pluginStoragePlugin
      });
    },

    exists: (rel) => {
      ensureDataNotIsolated();
      return core.invoke<boolean>("lia_fs_exists", {
        rel,
        permanent,
        windowLabel: undefined,
        pluginStoragePlugin
      });
    },

    move: (src, dest, opts) => {
      ensureDataNotIsolated();
      return core.invoke<void>("lia_fs_move", {
        src,
        dest,
        permanent,
        createDirs: opts?.createDirs,
        overwrite: opts?.overwrite,
        windowLabel: undefined,
        pluginStoragePlugin
      });
    },

    copy: (src, dest, opts) => {
      ensureDataNotIsolated();
      return core.invoke<void>("lia_fs_copy", {
        src,
        dest,
        permanent,
        recursive: opts?.recursive,
        createDirs: opts?.createDirs,
        overwrite: opts?.overwrite,
        windowLabel: undefined,
        pluginStoragePlugin
      });
    },
  }
};

// Comments are in English
function scope(
  core: { invoke: LiatirAPI["invoke"] },
  permanent: boolean,
): FsScopeMethods {
  const ensureDataNotIsolated = () => {};

  const coreMethods: FsCoreMethods = scopeCoreMethods(core, permanent);

  const mainScopeMethods: FsScopeMethods = {
    ...coreMethods,
    path: async () => {
      ensureDataNotIsolated();
      const p = await core.invoke<FsPaths>("lia_fs_paths");
      return permanent ? p.data : p.cache;
    },

    clear: async () => {
      ensureDataNotIsolated();
      if (permanent) {
        return core.invoke<void>("lia_fs_clear_data");
      }
      return core.invoke<void>("lia_fs_clear_cache");
    },

    base: permanent ? ".data" : ".cache",
  };

  return mainScopeMethods;
}

function pluginFsScope(
  core: { invoke: LiatirAPI["invoke"] },
  plugin: string,
): FsPluginMethods {

  const pluginName = ((plugin?.trim()) ?? undefined);
  const sanitizedPluginName = (normalizePluginName(pluginName)?.trim()) ?? undefined;

  if(!sanitizedPluginName) throw("Invalid plugin name");

  const coreMethods: FsCoreMethods = scopeCoreMethods(core, true, sanitizedPluginName);

  return {
    ...coreMethods,
    clearStorage: async () => core.invoke<void>("lia_plugin_storage_clear", {plugin: sanitizedPluginName})
  }
}

export function buildFs(core: {
  invoke: LiatirAPI["invoke"];
}): FsInterface {
  const cache = scope(core, false);
  const data = scope(core, true);
  return {
    cache,
    data,
    pluginFs: (plugin: string) => pluginFsScope(core, plugin),
    paths: async () => core.invoke<FsPaths>("lia_fs_paths"),
    base: { cache: ".cache", data: ".data" },
    trash: {
      clear: async () => core.invoke<void>("lia_fs_data_clear_trash"),
      recover: async () => core.invoke<void>("lia_fs_data_recover_trash"),
      listContent: async (rel: string = "") =>
        core.invoke<FsEntry[]>("lia_fs_trash_list_dir", { rel }),
      stat: async (rel: string = "") =>
        core.invoke<FsEntry>("lia_fs_trash_stat", { rel }),
      exists: async (rel: string = "") =>
        core.invoke<boolean>("lia_fs_trash_exists", { rel }),
      readText: async (rel: string) =>
        core.invoke<string>("lia_fs_trash_read_text", { rel }),
      readBytes: async (rel: string) =>
        core.invoke<string>("lia_fs_trash_read_bytes", { rel }),
    },
    diagnostics: {
      clear: async () => core.invoke<void>("lia_fs_diagnostics_clear"),
      remove: async (rel: string, recursive = false) =>
        core.invoke<void>("lia_fs_diagnostics_rm", { rel, recursive }),
      listContent: async (rel: string = "") =>
        core.invoke<FsEntry[]>("lia_fs_diagnostics_list_dir", { rel }),
      stat: async (rel: string = "") =>
        core.invoke<FsEntry>("lia_fs_diagnostics_stat", { rel }),
      exists: async (rel: string = "") =>
        core.invoke<boolean>("lia_fs_diagnostics_exists", { rel }),
      readText: async (rel: string) =>
        core.invoke<string>("lia_fs_diagnostics_read_text", { rel }),
      readBytes: async (rel: string) =>
        core.invoke<string>("lia_fs_diagnostics_read_bytes", { rel }),
    },
  };
}
