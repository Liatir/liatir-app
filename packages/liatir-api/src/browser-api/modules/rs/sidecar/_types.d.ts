export interface SidecarResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    error: string | null;
    durationMs: number;
}
export interface SidecarInterface {
    /**
     * Run a registered sidecar binary and capture stdout/stderr.
     *
     * The binary must be declared in `bundle.externalBin` in tauri.conf.json.
     *
     * TODO: add real bio tool sidecars here as they are bundled, e.g.:
     *   - "samtools"   → SAM/BAM processing
     *   - "minimap2"   → long-read alignment
     *   - "bwa"        → short-read alignment
     *   - "bcftools"   → VCF/BCF manipulation
     *   - "fastqc"     → QC reports (requires JVM or standalone binary)
     */
    run: (name: string, args: string[]) => Promise<SidecarResult>;
}
