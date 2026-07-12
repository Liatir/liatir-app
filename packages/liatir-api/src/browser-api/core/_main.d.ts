export declare function buildCore(): {
    /** Resolves once the bridge can actually talk to Rust. */
    readonly ready: Promise<true>;
    invoke<T = unknown>(cmd: string, payload?: Record<string, unknown>): Promise<T>;
};
