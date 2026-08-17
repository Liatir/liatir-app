import type { LiaPlatform } from "../../../liatir/_types";
import type { I32 } from "../../../utils/utils/_integerUtils";
/**
 * Information about a window managed by Liatir.
 */
export type AppWindowInfo = {
    label: string;
    width: number;
    height: number;
    x: number;
    y: number;
    is_fullscreen: boolean;
    is_maximized: boolean;
    is_minimized: boolean;
    is_visible: boolean;
};
/**
 * Information about a screen/monitor available to the system.
 */
export type AppScreenInfo = {
    name: string;
    width: number;
    height: number;
    x: number;
    y: number;
    scale_factor: number;
};
/**
 * Information about the current Liatir runtime environment.
 */
export type AppInfo = {
    arch: string;
    current_dir: string;
    exec_dir: string;
    exec_path: string;
    has_main_window: boolean;
    is_debug: boolean;
    name: string;
    now_unix_ms: number;
    os: LiaPlatform | string;
    pid: number;
    primary_screen: AppScreenInfo;
    screens: AppScreenInfo[];
    temp_dir: string;
    version: string;
    windows: AppWindowInfo[];
};
export type AppUpdateCheckResult = {
    available: boolean;
    currentVersion: string;
    version?: string | null;
    publishedAt?: string | null;
    notes?: string | null;
};
export type AppUpdateInstallResult = {
    version: string;
};
export interface AppUpdatesInterface {
    /** Check the signed release feed. This is the only operation that needs network access. */
    check: () => Promise<AppUpdateCheckResult>;
    /** Download, verify and install the update selected by the latest check. */
    install: () => Promise<AppUpdateInstallResult>;
    /** Restart Liatir after installation. Refused while a Job is running. */
    restart: () => Promise<void>;
}
export interface AppInterface {
    info: () => Promise<AppInfo>;
    exit: (code?: I32 | undefined) => Promise<void>;
    updates: AppUpdatesInterface;
}
