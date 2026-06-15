import { PluginsInterface } from "../rs/plugins/_types";
import { buildFastqc } from "./fastqc/_main";
import { QcInterface } from "./_types";

export function buildQc(deps: { plugins: PluginsInterface }): QcInterface {
  return {
    fastqc: buildFastqc(deps.plugins),
  };
}
