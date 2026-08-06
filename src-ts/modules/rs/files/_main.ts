/**
 * `Liatir.desktop.files` — the native open/save dialogs.
 *
 * `openWithBytes` returns the file's contents along with its path, which saves a second round trip for the
 * small files the webview wants to read immediately. For a large one, prefer `open` and read it through `fs`
 * — `maxBytes` is the guard that stops a multi-gigabyte file being pulled into memory by accident.
 */
import { LiatirAPI, FilesInterface, OpenResultWithBytes } from "../../../types";
import { OpenResult } from "../../../types";
import { U64 } from "../../../utils";

export function buildFiles(core: { invoke: LiatirAPI["invoke"] }): FilesInterface {
  return {
    open: (options?: { multi?: boolean, allowed?: string[], maxBytes?: U64 }) =>
      core.invoke<OpenResult>("lia_file_open", { multi: options?.multi ?? false, allowedExtensions: options?.allowed, maxBytes: options?.maxBytes }),
    openWithBytes: (options?: { multi?: boolean, allowed?: string[], maxBytes?: U64 }) =>
      core.invoke<OpenResultWithBytes>("lia_file_open_with_bytes", { multi: options?.multi ?? false, allowedExtensions: options?.allowed, maxBytes: options?.maxBytes }),
    save: (defaultName?: string | null) =>
      core.invoke<string>("lia_file_save", { defaultName: defaultName ?? null }),
  };
}
