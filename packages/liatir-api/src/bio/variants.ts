// Bio namespace: variant analysis (Liatir.variants.*)
//
// Typed wrappers returning a rendered ToolOutput via the shared @liatir/output-parser.
// bcftools shells out via the job manager; SnpEff uses the native command (which
// manages the JVM + reads back annotation stats from stderr).

import {
  parseBcftoolsStats,
  bcftoolsStatsToToolOutput,
  parseSnpEffStats,
  buildSnpEffOutput,
  type ToolOutput,
} from "@liatir/output-parser";
import type { LiatirNodeJobs } from "../index";
import { resolveThreads } from "./_threads";

type Invoke = <T>(cmd: string, payload?: Record<string, unknown>) => Promise<T>;

export interface VariantsDeps {
  jobs: LiatirNodeJobs;
  invoke: Invoke;
}

export interface SnpEffArgs {
  /** Input VCF. */
  input: string;
  /** Genome database id (e.g. "hg38"). */
  genome: string;
  /** Path to snpEff.jar. */
  jarPath: string;
  /** SnpEff data dir (downloaded databases). */
  dataDir: string;
  /** Where to write the annotated VCF. */
  outputVcf: string;
  /** JVM heap (e.g. "4g"). */
  heap?: string;
  /** Explicit java binary (optional). */
  javaPath?: string;
}

export interface SnpEffResult {
  output: ToolOutput;
  outputVcf: string;
}

export interface BcftoolsFilterArgs {
  /** Input VCF/BCF. */
  input: string;
  /** Where to write the filtered VCF (bgzipped, `-O z`). */
  outputVcf: string;
  /** Filter expression for `-i` (default `QUAL>20`). */
  expression?: string;
  /** Worker threads. */
  threads?: number;
}

export interface BcftoolsFilterResult {
  /** Path to the filtered VCF. */
  outputVcf: string;
  /** The expression that was applied. */
  expression: string;
}

export interface VariantsNamespace {
  /** Variant statistics (`bcftools stats`). */
  bcftoolsStats(args: { input: string; threads?: number }): Promise<ToolOutput>;
  /** Filter variants by expression (`bcftools filter -i`). Writes a bgzipped VCF. */
  bcftoolsFilter(args: BcftoolsFilterArgs): Promise<BcftoolsFilterResult>;
  /** Functional annotation with SnpEff. Requires a configured JAR + data dir. */
  snpeff(args: SnpEffArgs): Promise<SnpEffResult>;
}

function genJobId(tool: string): string {
  return `${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildVariants({ jobs, invoke }: VariantsDeps): VariantsNamespace {
  return {
    async bcftoolsStats({ input, threads }) {
      let stdout = "";
      const entry = await jobs.run("bcftools", ["stats", "--threads", String(resolveThreads(threads)), input], { onStdout: (l) => { stdout += l + "\n"; } });
      if (entry.status.type !== "done") throw new Error("bcftools failed");
      const parsed = parseBcftoolsStats(stdout);
      return bcftoolsStatsToToolOutput(parsed, stdout);
    },

    async bcftoolsFilter({ input, outputVcf, expression, threads }) {
      const expr = expression?.trim() || "QUAL>20";
      const entry = await jobs.run("bcftools", [
        "filter",
        "--threads", String(resolveThreads(threads)),
        "-i", expr,
        "-O", "z",
        "-o", outputVcf,
        input,
      ]);
      if (entry.status.type !== "done") throw new Error("bcftools filter failed");
      return { outputVcf, expression: expr };
    },

    async snpeff({ input, genome, jarPath, dataDir, outputVcf, heap, javaPath }) {
      const jobId = genJobId("snpeff");
      const res = await invoke<{ ok: boolean; stderr: string[] }>("lia_snpeff_annotate", {
        jarPath,
        genome,
        dataDir,
        inputVcf: input,
        outputVcf,
        heap: heap ?? "4g",
        jobId,
        javaPath: javaPath ?? null,
      });
      if (!res.ok) throw new Error("snpeff failed");
      const summary = parseSnpEffStats(res.stderr.join("\n"));
      return { output: buildSnpEffOutput(summary, outputVcf), outputVcf };
    },
  };
}
