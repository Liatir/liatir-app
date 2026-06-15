import { OfflabAPI } from "../../../types";
import { DepCheckResult, DepsInterface } from "./_types";

export function buildDeps(core: { invoke: OfflabAPI["invoke"] }): DepsInterface {
  return {
    check: (binary: string): Promise<DepCheckResult> =>
      core.invoke("dtr_deps_check", { binary }),

    checkMany: (binaries: string[]): Promise<DepCheckResult[]> =>
      core.invoke("dtr_deps_check_many", { binaries }),
  };
}
