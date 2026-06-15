import type { FastqcInterface } from "./fastqc/_types";

export type QcInterface = {
  fastqc: FastqcInterface;
  // TODO: multiqc: MultiqcInterface;
  // TODO: trimmomatic: TrimmomaticInterface;
};
