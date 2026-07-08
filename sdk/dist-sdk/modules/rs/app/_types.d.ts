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
export interface AppInterface {
    info: () => Promise<AppInfo>;
    exit: (code?: I32 | undefined) => Promise<void>;
}
