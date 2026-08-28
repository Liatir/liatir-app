/** Stable identities and bounded inputs shared by the Phase 2 oncology surfaces. */
export const MHCFLURRY_CLASS1_PRESENTATION_MODEL_ID = "openvax-mhcflurry-class1-presentation";
export const MHCFLURRY_EPITOPE_TOOL_ID = "ai-mhc-class-i-epitope-prediction";
export const PVACTOOLS_RUNTIME_COMPONENT_ID = "griffithlab-pvactools-pvacseq";
export const PVACTOOLS_RUNTIME_ID = "oncology-pvactools-pvacseq-7-1-2";
export const NEOANTIGEN_PRIORITIZATION_TOOL_ID = "neoantigen-prioritization";

export const MHC_CLASS_I_PEPTIDE_LENGTHS = [8, 9, 10, 11, 12, 13, 14, 15] as const;
export const PVACSEQ_DEFAULT_PEPTIDE_LENGTHS = [8, 9, 10, 11] as const;

export type LiatirMhcClass1PredictionMode = "binding" | "presentation";

export const ONCOLOGY_EXPERIMENTAL_CANDIDATE_NOTICE =
  "These predictions prioritize experimental candidates. They are not a validated vaccine, therapy, or diagnostic result.";

/** Parses a user list without guessing malformed HLA Class I allele names. */
export function parseMhcClassIAlleles(value: string): string[] {
  const alleles = [...new Set(value.split(/[\s,;]+/u).map((item) => item.trim()).filter(Boolean))];
  if (alleles.length === 0) throw new Error("At least one HLA Class I allele is required.");
  if (alleles.length > 12) throw new Error("At most 12 HLA Class I alleles can be run together.");
  const invalid = alleles.find((allele) => !/^HLA-[ABC]\*\d{2}:\d{2}(?::\d{2})?$/u.test(allele));
  if (invalid) {
    throw new Error(`Invalid HLA Class I allele: ${invalid}. Use a name such as HLA-A*02:01.`);
  }
  return alleles;
}

/** Accepts comma or space separated lengths and keeps the supported MHCflurry range explicit. */
export function parseMhcClassIPeptideLengths(value: string): number[] {
  const tokens = value.split(/[\s,;]+/u).map((item) => item.trim()).filter(Boolean);
  if (tokens.length === 0) throw new Error("At least one peptide length is required.");
  const parsed = tokens.map((item) => Number(item));
  if (parsed.some((item) => !Number.isFinite(item))) {
    throw new Error("MHC Class I peptide lengths must be whole numbers from 8 to 15.");
  }
  const lengths = [...new Set(parsed)]
    .sort((left, right) => left - right);
  const supported = new Set<number>(MHC_CLASS_I_PEPTIDE_LENGTHS);
  const invalid = lengths.find((length) => !Number.isSafeInteger(length) || !supported.has(length));
  if (invalid !== undefined) throw new Error("MHC Class I peptide lengths must be whole numbers from 8 to 15.");
  return lengths;
}
