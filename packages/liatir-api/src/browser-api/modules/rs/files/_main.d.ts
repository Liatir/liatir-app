/**
 * `Liatir.desktop.files` — the native open/save dialogs.
 *
 * `openWithBytes` returns the file's contents along with its path, which saves a second round trip for the
 * small files the webview wants to read immediately. For a large one, prefer `open` and read it through `fs`
 * — `maxBytes` is the guard that stops a multi-gigabyte file being pulled into memory by accident.
 */
import { LiatirAPI, FilesInterface } from "../../../types";
export declare function buildFiles(core: {
    invoke: LiatirAPI["invoke"];
}): FilesInterface;
