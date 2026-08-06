/** Small shared helpers for the bridge's own use. */
import { LiaPlatform } from "../types";
/** Trims, collapses runs of whitespace, and (by default) lowercases. Used to normalise identifiers. */
export declare const normalizeString: (str: string, options?: {
    toLowerCase: boolean;
    spacesFiller: string;
}) => string;
/**
 * Guard for platform-specific API methods.
 *
 * Some capabilities exist only on some operating systems (a dock badge, say). Calling one where it does not
 * exist would otherwise fail deep in Rust with an opaque error; throwing here names the platform and the
 * method, so a plugin author sees immediately why their call cannot work.
 */
export declare const platformSpecifcFilter: (platforms: LiaPlatform[]) => Promise<void>;
export declare const getAppVersion: () => Promise<string>;
