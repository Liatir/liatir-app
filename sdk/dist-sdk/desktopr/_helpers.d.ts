import { DtrPlatform } from "../types";
export declare const normalizeString: (str: string, options?: {
    toLowerCase: boolean;
    spacesFiller: string;
}) => string;
export declare const platformSpecifcFilter: (platforms: DtrPlatform[]) => Promise<void>;
export declare const getAppVersion: () => Promise<string>;
