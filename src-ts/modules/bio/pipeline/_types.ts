import type { PluginCallPayload, PluginCallResult } from "../../rs/plugins/_types";
import type { SidecarResult } from "../../rs/sidecar/_types";
import type { U64 } from "../../../utils/utils/_integerUtils";

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

export type WasmStep = {
  kind: "wasm";
  /** .wasm plugin name as registered via Liatir.plugins.add() */
  plugin: string;
  payload: PluginCallPayload;
  timeoutMs?: U64;
};

export type SidecarStep = {
  kind: "sidecar";
  /** Sidecar binary name declared in bundle.externalBin */
  binary: string;
  args: string[];
};

/**
 * A pipeline step is either a WASM plugin call or a native sidecar invocation.
 *
 * TODO: extend with additional step kinds as needed, e.g.:
 *   - "fs-transform"   → read/write file in the sandbox without a full binary
 *   - "http-fetch"     → download reference data (e.g. genome index)
 */
export type PipelineStep = (WasmStep | SidecarStep) & {
  /** Human-readable label for logging and UI display */
  label: string;
};

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type StepStatus = "pending" | "running" | "done" | "error";

export type StepResult = {
  label: string;
  status: StepStatus;
  durationMs: number;
  /** Raw output from the step (stdout for sidecar, stdout+value for wasm) */
  output: PluginCallResult | SidecarResult | null;
  error: string | null;
};

export type PipelineResult = {
  ok: boolean;
  steps: StepResult[];
  totalDurationMs: number;
  /** Index of the first failed step, or null if all succeeded */
  failedAt: number | null;
};

// ---------------------------------------------------------------------------
// Pipeline interface
// ---------------------------------------------------------------------------

export interface PipelineInterface {
  /**
   * Execute a sequence of steps in order.
   * Stops at the first failure unless `continueOnError` is true.
   *
   * TODO: add real bio pipeline presets here, e.g.:
   *   - shortReadQC(fastqPath)         → FastQC → MultiQC
   *   - alignShortReads(fastq, ref)    → BWA-MEM → samtools sort/index
   *   - callVariants(bam, ref)         → GATK HaplotypeCaller → bcftools filter
   *   - annotateVariants(vcf)          → VEP or SnpEff
   */
  run: (steps: PipelineStep[], opts?: { continueOnError?: boolean }) => Promise<PipelineResult>;
}
