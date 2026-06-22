// Bio namespace: alignment tools (Liatir.align.*)
//
// These are thin, typed wrappers over the native Liatir commands that the IPC
// server exposes to .lia Modules. A Module author writes:
//
//     const r = await Liatir.align.bwaMem({ reference, readsR1, outputSam });
//
// instead of remembering CLI flags. The heavy lifting — reference
// auto-indexing, SAM output redirection, stderr/stat capture — stays in the
// Rust command (crate::bridge::bwa / minimap2), so there is a single source of
// truth shared with the desktop UI.

/** Minimal shape of the IPC `invoke` injected by the adapter factory. */
type Invoke = <T>(cmd: string, payload?: Record<string, unknown>) => Promise<T>;

/** Result returned by the native alignment commands. */
export interface AlignResult {
  ok: boolean;
  exitCode: number | null;
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
}

export interface AlignNamespace {
  /** Map short reads to a reference with BWA-MEM. */
  bwaMem(args: BwaMemArgs): Promise<AlignResult>;
  /** Map long or short reads with minimap2. */
  minimap2(args: Minimap2Args): Promise<AlignResult>;
}

/** Generate a unique job id for a tool run (used by the native command for log events). */
function genJobId(tool: string): string {
  return `${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The raw payload a native alignment command returns (before we echo outputSam). */
type NativeAlignResult = { ok: boolean; exitCode: number | null; stderr: string[] };

/** Build the `align` namespace bound to a specific IPC `invoke`. */
export function buildAlign(invoke: Invoke): AlignNamespace {
  return {
    async bwaMem(args) {
      const jobId = genJobId("bwa");
      const res = await invoke<NativeAlignResult>("lia_bwa_mem", {
        reference: args.reference,
        readsR1: args.readsR1,
        readsR2: args.readsR2 ?? null,
        outputSam: args.outputSam,
        jobId,
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
      });
      return { ...res, outputSam: args.outputSam };
    },
  };
}
