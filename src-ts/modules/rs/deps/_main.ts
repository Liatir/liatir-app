import { LiatirAPI } from "../../../types";
import { DepCheckResult, DepsInterface } from "./_types";

export function buildDeps(core: { invoke: LiatirAPI["invoke"] }): DepsInterface {
  return {
    check: (binary: string): Promise<DepCheckResult> =>
      core.invoke("dtr_deps_check", { binary }),

    checkMany: (binaries: string[]): Promise<DepCheckResult[]> =>
      core.invoke("dtr_deps_check_many", { binaries }),
  };
}
