export declare function buildCore(): {
    readonly ready: Promise<true>;
    invoke<T = unknown>(cmd: string, payload?: Record<string, unknown>): Promise<T>;
};
