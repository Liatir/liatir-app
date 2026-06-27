import type { DesktopInterface } from "../modules/desktop/_types";
import type { PluginsInterface } from "../modules/rs/plugins/_types";
import type { SidecarInterface } from "../modules/rs/sidecar/_types";
import type { PipelineInterface } from "../modules/bio/pipeline/_types";
import type { JobsInterface } from "../modules/rs/jobs/_types";
import type { DepsInterface } from "../modules/rs/deps/_types";
import type { QcInterface } from "../modules/qc/_types";
import { WindowTauri } from "../core/_types";
export type LiaPlatform = "macos" | "linux" | "windows";
export type LiatirAPI = {
    readonly isAvailable: boolean;
    readonly apiVersion: string;
    readonly ready: Promise<true>;
    invoke<T = unknown>(cmd: string, payload?: Record<string, unknown>): Promise<T>;
    isDesktop: boolean;
    /** Native desktop bridge — window, fs, notifications, clipboard, etc. */
    desktop: DesktopInterface;
    /** Low-level WASM runtime. Use bio namespaces (qc, …) for typed wrappers. */
    plugins: PluginsInterface;
    /** Run bundled native sidecars (declared in bundle.externalBin). */
    sidecar: SidecarInterface;
    /** Chain WASM + sidecar steps into a sequential pipeline. */
    pipeline: PipelineInterface;
    /** Async process manager — spawn, stream, kill any system binary. */
    jobs: JobsInterface;
    /** Check whether system tools are installed and get their versions. */
    deps: DepsInterface;
    qc: QcInterface;
    tauri?: WindowTauri;
    onReady: (callback: Function) => void;
    openBrowser: (url: string) => Promise<void>;
};
export interface LiatirInstanceInterface {
    ready: () => boolean;
    get: () => LiatirAPI;
}
