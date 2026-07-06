import { LiaPlatform } from "../types";
export declare const normalizeString: (str: string, options?: {
    toLowerCase: boolean;
    spacesFiller: string;
}) => string;
export declare const platformSpecifcFilter: (platforms: LiaPlatform[]) => Promise<void>;
export declare const getAppVersion: () => Promise<string>;
//# sourceMappingURL=_helpers.d.ts.map