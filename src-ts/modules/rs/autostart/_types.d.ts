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
//# sourceMappingURL=_types.d.ts.map