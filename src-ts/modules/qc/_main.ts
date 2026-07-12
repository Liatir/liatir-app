/**
 * `Liatir.qc` — the quality-control tools (FastQC). Unlike `modules/rs/*`, which wrap Rust capabilities, these
 * are the analysis tools themselves.
 */
import { buildFastqc } from "./fastqc/_main";
import { QcInterface } from "./_types";
import type { LiatirAPI } from "../../types";

export function buildQc(core: { invoke: LiatirAPI["invoke"] }): QcInterface {
  return {
    fastqc: buildFastqc(core),
  };
}
