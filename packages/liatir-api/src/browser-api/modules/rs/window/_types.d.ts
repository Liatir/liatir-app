export type _WindowTypesPlaceholder = unknown;
export interface WindowInterface {
    new: (options?: NewWindowOptions) => Promise<void>;
    close: (label: string) => Promise<void>;
    minimize: () => Promise<void>;
    maximizeToggle: () => Promise<void>;
    fullscreen: (enable: boolean) => Promise<void>;
    getInfo: (label?: string) => Promise<WindowInfo>;
}
export type WindowSizeInfo = {
    width: number;
    height: number;
};
export type WindowPositionInfo = {
    x: number;
    y: number;
};
export type WindowInfo = {
    label: string;
    title?: string | null;
    url?: string | null;
    visible?: boolean | null;
    focused?: boolean | null;
    minimized?: boolean | null;
    maximized?: boolean | null;
    fullscreen?: boolean | null;
    decorated?: boolean | null;
    resizable?: boolean | null;
    enabled?: boolean | null;
    always_on_top?: boolean | null;
    inner_size?: WindowSizeInfo | null;
    outer_size?: WindowSizeInfo | null;
    inner_position?: WindowPositionInfo | null;
    outer_position?: WindowPositionInfo | null;
    scale_factor?: number | null;
};
export type NewWindowOptions = {
    label?: string;
    fullscreen?: boolean;
    url?: string;
};
