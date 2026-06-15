import { OfflabAPI } from "../../../types";
import { SidecarInterface, SidecarResult } from "./_types";

export function buildSidecar(core: { invoke: OfflabAPI["invoke"] }): SidecarInterface {
  return {
    run: (name: string, args: string[]): Promise<SidecarResult> =>
      core.invoke("dtr_sidecar_run", { name, args }),
  };
}
