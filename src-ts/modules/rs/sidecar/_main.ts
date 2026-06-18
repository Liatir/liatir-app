import { LiatirAPI } from "../../../types";
import { SidecarInterface, SidecarResult } from "./_types";

export function buildSidecar(core: { invoke: LiatirAPI["invoke"] }): SidecarInterface {
  return {
    run: (name: string, args: string[]): Promise<SidecarResult> =>
      core.invoke("dtr_sidecar_run", { name, args }),
  };
}
