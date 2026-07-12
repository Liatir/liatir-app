/**
 * `Liatir.desktop.fs` — filesystem access, always inside a *scope*.
 *
 * The whole design of this module is that there is no unscoped filesystem API. A caller never names an absolute
 * path; it names a path *relative to a scope* — the user's data, the cache, a plugin's own storage, the trash,
 * the diagnostics logs — and Rust resolves that against the scope's root with traversal forbidden. So a plugin
 * cannot reach outside its own storage, and nothing in the webview can touch arbitrary files, by construction
 * rather than by validation.
 *
 * `scopeCoreMethods` is the shared implementation of those operations; each scope is that same set of methods
 * bound to a different root.
 */
import { LiatirAPI } from "../../../types";
import type { FsInterface } from "../../../types";
export declare function buildFs(core: {
    invoke: LiatirAPI["invoke"];
}): FsInterface;
