export type DepCheckResult = {
    available: boolean;
    binary: string;
    path: string | null;
    version: string | null;
    /**
     * Where the answer came from. `bundled` is a Native Tool that ships inside the
     * application: it is reported from the build manifest instead of probed, so it
     * is never missing and has no host path on Windows, where it lives in WSL2.
     */
    source: "bundled" | "path";
};
export interface DepsInterface {
    /** Check whether a dependency is available, from the bundle or from PATH */
    check: (binary: string) => Promise<DepCheckResult>;
    /** Check multiple dependencies at once */
    checkMany: (binaries: string[]) => Promise<DepCheckResult[]>;
}
