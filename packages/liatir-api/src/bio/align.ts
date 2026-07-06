// Bio namespace: alignment tools (Liatir.align.*)
//
// These are thin, typed wrappers over the native Liatir commands that the IPC
// server exposes to .lia plugins. A plugin author writes:
//
//     const r = await Liatir.align.bwaMem({ reference, readsR1, outputSam });
//
// instead of remembering CLI flags. The heavy lifting — reference
// auto-indexing, SAM output redirection, stderr/stat capture — stays in the
// Rust command (crate::bridge::bwa / minimap2), so there is a single source of
// truth shared with the desktop UI.

import { parseFlagstatResult, flagstatToToolOutput, type ToolOutput } from "@liatir/output-parser";
import type { LiatirNodeJobs } from "../index";
import { resolveThreads } from "./_threads";

/** Minimal shape of the IPC `invoke` injected by the adapter factory. */
type Invoke = <T>(cmd: string, payload?: Record<string, unknown>) => Promise<T>;

/** Result returned by the native alignment commands. */
export interface AlignResult {
  ok: boolean;
  exitCode: number | null;
  /** Worker threads actually used by the native command, when reported. */
  threads?: number;
  /** Captured stderr lines — also where BWA/minimap2 print their run stats. */
  stderr: string[];
  /** Absolute path of the produced SAM file (echoed back for convenience). */
  outputSam: string;
}

export interface BwaMemArgs {
  /** Reference FASTA. Indexed automatically on first use. */
  reference: string;
  /** Reads R1 (FASTQ / FASTQ.gz). */
  readsR1: string;
  /** Reads R2 for paired-end data (optional). */
  readsR2?: string;
  /** Where to write the output SAM. */
  outputSam: string;
  /** Worker threads. Omit or use 0 to let Liatir choose a safe local value. */
  threads?: number;
}

export interface Minimap2Args {
  /** Reference FASTA. */
  reference: string;
  /** Reads (FASTQ / FASTQ.gz). */
  reads: string;
  /** Where to write the output SAM. */
  outputSam: string;
  /** Alignment preset: 'sr' (short read), 'lr', 'map-ont', … (default 'sr'). */
  preset?: string;
  /** Worker threads. Omit or use 0 to let Liatir choose a safe local value. */
  threads?: number;
}

export interface FaidxResult {
  /** Path of the produced FASTA index (`<input>.fai`). */
  faiPath: string;
}

export interface AlignNamespace {
  /** Map short reads to a reference with BWA-MEM. */
  bwaMem(args: BwaMemArgs): Promise<AlignResult>;
  /** Map long or short reads with minimap2. */
  minimap2(args: Minimap2Args): Promise<AlignResult>;
  /** Alignment summary stats (`samtools flagstat`) over a SAM/BAM file. */
  flagstat(args: { input: string; threads?: number }): Promise<ToolOutput>;
  /** Index a FASTA reference (`samtools faidx`), producing `<input>.fai`. */
  faidx(args: { input: string; threads?: number }): Promise<FaidxResult>;
}

/** Generate a unique job id for a tool run (used by the native command for log events). */
function genJobId(tool: string): string {
  return `${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The raw payload a native alignment command returns (before we echo outputSam). */
type NativeAlignResult = { ok: boolean; exitCode: number | null; stderr: string[]; threads?: number };

/** Build the `align` namespace bound to a specific IPC `invoke` and job runner. */
export function buildAlign({ invoke, jobs }: { invoke: Invoke; jobs: LiatirNodeJobs }): AlignNamespace {
  return {
    async bwaMem(args) {
      const jobId = genJobId("bwa");
      const res = await invoke<NativeAlignResult>("lia_bwa_mem", {
        reference: args.reference,
        readsR1: args.readsR1,
        readsR2: args.readsR2 ?? null,
        outputSam: args.outputSam,
        jobId,
        threads: args.threads ?? 0,
      });
      return { ...res, outputSam: args.outputSam };
    },

    async minimap2(args) {
      const jobId = genJobId("minimap2");
      const res = await invoke<NativeAlignResult>("lia_minimap2", {
        preset: args.preset ?? "sr",
        reference: args.reference,
        readsR1: args.reads,
        readsR2: null,
        outputSam: args.outputSam,
        jobId,
        threads: args.threads ?? 0,
      });
      return { ...res, outputSam: args.outputSam };
    },

    async flagstat({ input, threads }) {
      let stdout = "";
      const entry = await jobs.run("samtools", ["flagstat", "-@", String(resolveThreads(threads)), input], {
        onStdout: (l) => { stdout += l + "\n"; },
      });
      if (entry.status.type !== "done") throw new Error("samtools flagstat failed");
      return flagstatToToolOutput(parseFlagstatResult(stdout), stdout);
    },

    async faidx({ input, threads }) {
      // samtools writes the .fai index next to the input FASTA automatically.
      const entry = await jobs.run("samtools", ["faidx", "-@", String(resolveThreads(threads)), input]);
      if (entry.status.type !== "done") throw new Error("samtools faidx failed");
      return { faiPath: `${input}.fai` };
    },
  };
}
