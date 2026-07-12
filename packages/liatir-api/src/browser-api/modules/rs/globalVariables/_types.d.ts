/**
 * Shapes for the shared key/value store. The value type is a closed union: only what can be persisted and
 * safely round-tripped is allowed in.
 */
export type GlobalVariablesAllowedTypes = string;
export interface GlobalVariablesInterface {
    get: (key: string) => Promise<string>;
    set: (key: string, value: GlobalVariablesAllowedTypes) => Promise<void>;
    remove: (key: string) => Promise<void>;
    list: (key: string) => Promise<{
        [key: string]: string;
    }>;
}
