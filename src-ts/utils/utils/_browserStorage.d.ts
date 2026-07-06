export type BrowserStorageType = "local" | "session";
interface _BrowserStorageAPI {
    getItem(key: string): unknown | null;
    getNamespaceItems(): {
        key: string;
        value: unknown;
    }[];
    getItemsByKeys(keys: string[]): {
        key: string;
        value: unknown;
    }[];
    setItem(key: string, value: unknown, options?: {
        expiresIn?: number;
    }): void;
    removeItem(key: string): void;
    clear(): void;
    clearExpired(): void;
    length(): number;
    keysList(): string[];
}
export declare function browserStorage(type: BrowserStorageType, namespace?: string): _BrowserStorageAPI;
export {};
//# sourceMappingURL=_browserStorage.d.ts.map