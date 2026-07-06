import type { DesktopInterface } from "../modules/desktop/_types";
import type { SidecarInterface } from "../modules/rs/sidecar/_types";
import type { PipelineInterface } from "../modules/bio/pipeline/_types";
import type { JobsInterface } from "../modules/rs/jobs/_types";
import type { DepsInterface } from "../modules/rs/deps/_types";
import type { QcInterface } from "../modules/qc/_types";
import type { WindowTauri } from "../core/_types";
export type LiaPlatform = "macos" | "linux" | "windows";
/** Browser/webview bridge exposed as window.Liatir inside the Tauri app. */
export type LiatirBrowserAPI = {
    readonly isAvailable: boolean;
    readonly apiVersion: string;
    readonly ready: Promise<true>;
    invoke<T = unknown>(cmd: string, payload?: Record<string, unknown>): Promise<T>;
    isDesktop: boolean;
    /** Native desktop bridge — window, fs, notifications, clipboard, etc. */
    desktop: DesktopInterface;
    /** Run bundled native sidecars (declared in bundle.externalBin). */
    sidecar: SidecarInterface;
    /** Chain sidecar steps into a sequential pipeline. */
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
/**
 * @deprecated Use LiatirBrowserAPI for the window.Liatir webview bridge.
 * LiatirAPI is kept only as a compatibility alias for older integrations.
 */
export type LiatirAPI = LiatirBrowserAPI;
export interface LiatirInstanceInterface {
    ready: () => boolean;
    get: () => LiatirBrowserAPI;
}
