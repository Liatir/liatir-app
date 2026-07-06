export type GlobalVariablesAllowedTypes = string;
export interface GlobalVariablesInterface {
    get: (key: string) => Promise<string>;
    set: (key: string, value: GlobalVariablesAllowedTypes) => Promise<void>;
    remove: (key: string) => Promise<void>;
    list: (key: string) => Promise<{
        [key: string]: string;
    }>;
}
