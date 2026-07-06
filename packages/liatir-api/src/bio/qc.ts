// Bio namespace: quality control (Liatir.qc.*)
//
// Typed wrappers that run QC tools and return a rendered ToolOutput, using the
// shared parsers from @liatir/output-parser so plugins and the app match exactly.
// seqkit/fastp shell out via the job manager; fastqc runs the bundled WASM custom-tool.

import {
  parseSeqkitStats,
  seqkitStatsToToolOutput,
  parseFastpJson,
  fastpToToolOutput,
  fastqcToToolOutput,
  type ToolOutput,
  type FastqcResult,
} from "@liatir/output-parser";
import type { LiatirNodeJobs, LiatirNodePaths } from "../index";
import { resolveThreads } from "./_threads";

type Invoke = <T>(cmd: string, payload?: Record<string, unknown>) => Promise<T>;

export interface QcDeps {
  jobs: LiatirNodeJobs;
  invoke: Invoke;
  paths: () => Promise<LiatirNodePaths>;
}

export interface FastpResult {
  /** Rendered QC stats (before/after filtering). */
  output: ToolOutput;
  /** Trimmed R1 path. */
  trimmedR1: string;
  /** Trimmed R2 path (paired-end only). */
  trimmedR2?: string;
}

export interface QcNamespace {
  /** Sequence statistics (`seqkit stats -a`). */
  seqkit(args: { input: string; all?: boolean; threads?: number }): Promise<ToolOutput>;
  /** FASTQ trimming + QC (`fastp`). Writes trimmed reads to `outDir` (default: temp dir). */
  fastp(args: { r1: string; r2?: string; outDir?: string; threads?: number }): Promise<FastpResult>;
  /** Quality-control report via the bundled fastqc WASM custom-tool. */
  fastqc(args: { input: string; maxReads?: number; timeoutMs?: number }): Promise<ToolOutput>;
}

/** Directory portion of a file path (cross-platform), for fastqc host read access. */
function parentDir(filePath: string): string {
  const sep = filePath.includes("/") ? "/" : "\\";
  const idx = filePath.lastIndexOf(sep);
  return idx > 0 ? filePath.substring(0, idx) : sep;
}

export function buildQc({ jobs, invoke, paths }: QcDeps): QcNamespace {
  return {
    async seqkit({ input, all = true, threads }) {
      let stdout = "";
      const args = ["stats", ...(all ? ["-a"] : []), "-j", String(resolveThreads(threads)), input];
      const entry = await jobs.run("seqkit", args, { onStdout: (l) => { stdout += l + "\n"; } });
      if (entry.status.type !== "done") throw new Error("seqkit failed");
      const parsed = parseSeqkitStats(stdout);
      if (!parsed) throw new Error("seqkit: could not parse output");
      return seqkitStatsToToolOutput(parsed, stdout);
    },

    async fastp({ r1, r2, outDir, threads }) {
      const dir = outDir ?? (await paths()).temp;
      const id = `${Date.now()}`;
      const jsonPath = `${dir}/fastp-${id}.json`;
      const out1 = `${dir}/fastp-${id}-R1.fastq.gz`;
      const out2 = `${dir}/fastp-${id}-R2.fastq.gz`;
      const args = ["--in1", r1, "--out1", out1, "--json", jsonPath, "--html", "/dev/null", "--thread", String(resolveThreads(threads))];
      if (r2) args.push("--in2", r2, "--out2", out2);
      const entry = await jobs.run("fastp", args);
      if (entry.status.type !== "done") throw new Error("fastp failed");
      const jsonText = await invoke<string>("lia_read_file_text", { path: jsonPath });
      const output = fastpToToolOutput(parseFastpJson(jsonText));
      return { output, trimmedR1: out1, trimmedR2: r2 ? out2 : undefined };
    },

    async fastqc({ input, maxReads, timeoutMs }) {
      const result = await invoke<{ ok: boolean; value?: unknown; stderr?: string; error?: string }>(
        "lia_plugin_call",
        {
          plugin: "fastqc.wasm",
          payload: { fn: "run", args: { input, maxReads } },
          timeoutMs: timeoutMs ?? 300_000,
          hostReadPaths: [parentDir(input)],
        },
      );
      if (!result.ok) throw new Error(result.stderr?.trim() || result.error || "fastqc failed");
      return fastqcToToolOutput(result.value as FastqcResult);
    },
  };
}
