/**
 * Autostart shapes. `AutostartMode` is *how* the app comes up at login (visible, or in the background) — a
 * separate question from whether it starts at all.
 */
export interface AutostartInterface {
    enable: () => Promise<void>;
    disable: () => Promise<void>;
    isEnabled: () => Promise<void>;
    mode: {
        get: () => Promise<void>;
        set: (mode: AutostartMode) => Promise<void>;
    };
}
export type AutostartMode = "shown" | "minimized" | "hidden";
