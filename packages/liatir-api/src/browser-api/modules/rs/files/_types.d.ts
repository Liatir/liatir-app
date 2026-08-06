/**
 * Results of the native file dialogs. `OpenResultWithBytes` is the variant that carries the file's contents
 * along with its path, saving a second round trip for small files.
 */
import type { U64, U8 } from "../../../utils/utils/_integerUtils";
export type FileWithBytes = {
    path: string;
    bytes: U8[];
};
export type OpenResult = {
    paths: string[];
};
export type OpenResultWithBytes = {
    files: FileWithBytes[];
};
export interface FilesInterface {
    open: (options?: {
        multi?: boolean;
        allowed?: string[];
        maxBytes?: U64;
    }) => Promise<OpenResult>;
    openWithBytes: (options?: {
        multi?: boolean;
        allowed?: string[];
        maxBytes?: U64;
    }) => Promise<OpenResultWithBytes>;
    save: (defaultName?: string | null) => Promise<string>;
}
