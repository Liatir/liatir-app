export type FsEntry = {
    name: string;
    path: string;
    is_dir: boolean;
    size?: number | null;
};
export type FsPaths = {
    cache: string;
    data: string;
};
export type FsCoreMethods = {
    listContent: (rel: string) => Promise<FsEntry[]>;
    newDirectory: (rel: string) => Promise<void>;
    remove: (rel: string, recursive?: boolean) => Promise<void>;
    stat: (rel: string) => Promise<FsEntry>;
    writeText: (rel: string, contents: string, opts?: {
        createDirs?: boolean;
        append?: boolean;
    }) => Promise<void>;
    readText: (rel: string) => Promise<string>;
    writeBytes: (rel: string, base64: string, opts?: {
        createDirs?: boolean;
    }) => Promise<void>;
    readBytes: (rel: string) => Promise<string>;
    exists: (rel: string) => Promise<boolean>;
    move: (src: string, dest: string, opts?: {
        createDirs?: boolean;
        overwrite?: boolean;
    }) => Promise<void>;
    copy: (src: string, dest: string, opts?: {
        recursive?: boolean;
        createDirs?: boolean;
        overwrite?: boolean;
    }) => Promise<void>;
};
export type FsScopeMethods = FsCoreMethods & {
    clear: () => Promise<void>;
    path: () => Promise<string>;
    base: string;
};
export type FsPluginMethods = FsCoreMethods & {
    clearStorage: () => Promise<void>;
};
export interface FsTrashMethods {
    clear: () => Promise<void>;
    recover: () => Promise<void>;
    listContent: (rel?: string | undefined) => Promise<FsEntry[]>;
    stat: (rel?: string) => Promise<FsEntry>;
    exists: (rel?: string) => Promise<boolean>;
    readText: (rel: string) => Promise<string>;
    readBytes: (rel: string) => Promise<string>;
}
export interface FsDiagnosticMethods {
    clear: () => Promise<void>;
    remove: (rel: string, recursive?: boolean | undefined) => Promise<void>;
    listContent: (rel?: string | undefined) => Promise<FsEntry[]>;
    stat: (rel?: string) => Promise<FsEntry>;
    exists: (rel?: string) => Promise<boolean>;
    readText: (rel: string) => Promise<string>;
    readBytes: (rel: string) => Promise<string>;
}
export interface FsInterface {
    cache: FsScopeMethods;
    data: FsScopeMethods;
    /** Scoped to the persistent storage of the selected plugin. */
    pluginFs: (plugin: string) => FsPluginMethods;
    paths: () => Promise<FsPaths>;
    base: {
        cache: string;
        data: string;
    };
    trash: FsTrashMethods;
    diagnostics: FsDiagnosticMethods;
}
