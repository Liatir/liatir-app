export type DepCheckResult = {
    available: boolean;
    binary: string;
    path: string | null;
    version: string | null;
};
export interface DepsInterface {
    /** Check if a single binary is available in PATH */
    check: (binary: string) => Promise<DepCheckResult>;
    /** Check multiple binaries at once */
    checkMany: (binaries: string[]) => Promise<DepCheckResult[]>;
}
