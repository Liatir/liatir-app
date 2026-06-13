export type CompanionState = {
    isCacheOnly?: boolean;
    sessionId?: string;
    windowLabel?: string;
};
export declare function getCacheOnlyWindowContext(): Promise<void>;
export declare function isCacheOnlyWindow(): boolean;
export declare function getCacheOnlyWindowLabel(): string | undefined;
export declare function getCacheOnlySessionId(): string | undefined;
