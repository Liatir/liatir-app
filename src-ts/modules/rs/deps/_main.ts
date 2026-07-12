/**
 * `Liatir.deps` — is a command-line tool present on this machine, and at what version?
 *
 * Each check shells out, so `checkMany` exists to probe a whole set in one round trip rather than one call per
 * binary — which is what the Dependencies screen and the startup check need.
 */
import { LiatirAPI } from "../../../types";
import { DepCheckResult, DepsInterface } from "./_types";

export function buildDeps(core: { invoke: LiatirAPI["invoke"] }): DepsInterface {
  return {
    check: (binary: string): Promise<DepCheckResult> =>
      core.invoke("lia_deps_check", { binary }),

    checkMany: (binaries: string[]): Promise<DepCheckResult[]> =>
      core.invoke("lia_deps_check_many", { binaries }),
  };
}
