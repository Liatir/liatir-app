# Native Tool Support Matrix

> **Superseded on macOS arm64, Linux x86_64 and Windows x86_64 (2026-08-21).**
> Six tools — samtools, bcftools, seqkit, fastp, bwa, minimap2 — now ship inside
> the application as one relocatable environment, and the resolver prefers it over
> both the managed-bin registry and `PATH`. Windows ships the Linux bundle and
> runs it through WSL2; that path was executed and verified end to end on
> 2026-08-21, so it is no longer a plan. The matrix below still describes what
> happens where no bundle exists: Intel Macs, Linux ARM64, and SnpEff. See
> [Native Tools as one bundled environment](./native-tools-bundled-environment.md).

Liatir resolves every pipeline and standalone Native Tool through the shared
Jobs backend.
The resolver prefers a Liatir-managed binary registered in
`managed-bins/index.json`, then falls back to the host `PATH`. This keeps
execution, cancellation, logs, parent pipeline identity, and provenance
consistent regardless of how the tool was installed.

## Managed release policy

A direct managed install is published only when the upstream project provides
an immutable precompiled release for the exact operating system and
architecture. Every advertised asset is pinned by version, byte size, and
SHA-256 digest in `frontend/src/lib/tools/binary-releases.ts`.

Missing upstream artifacts are not replaced with unofficial mirrors, guessed
URLs, cross-architecture binaries, or source builds hidden behind the Install
button. Those hosts use the explicit package-manager path instead.

## Current release matrix

| Tool | macOS x86_64 | macOS arm64 | Linux x86_64 | Linux arm64 | Windows x86_64 |
| --- | --- | --- | --- | --- | --- |
| SeqKit 2.13.0 | Managed | Managed | Managed | Managed | Managed |
| minimap2 2.31 | Package manager | Package manager | Managed | Package manager | Package manager |
| bwa | Package manager | Package manager | Package manager | Package manager | Package manager |
| samtools | Package manager | Package manager | Package manager | Package manager | Package manager |
| bcftools | Package manager | Package manager | Package manager | Package manager | Package manager |
| fastp | Package manager | Package manager | Package manager | Package manager | Package manager |

bwa has no managed row because lh3/bwa publishes source tarballs only. bwa-mem2
does publish a Linux binary and was listed here until 2026-08-21, but under its
own name, which no caller and no dependency requirement asks for; see
[the bwa decision](./native-tools-bundled-environment.md#bwa-use-the-original-retire-bwa-mem2).

SnpEff remains a modular Java/JAR runtime with its databases managed
separately. Direct and pipeline annotation use the same Jobs execution path.

## Verification gates

- Unit tests reject release records without immutable HTTPS URLs, versions,
  byte sizes, SHA-256 digests, or verification dates.
- The heavy native dependency E2E that downloaded, installed, executed and
  removed the real SeqKit release was replaced on 2026-08-21: every binary this
  registry can still offer is now inside the bundled environment, so its Install
  button no longer exists. What replaces it proves that a bare tool name spawned
  through the shared Jobs backend runs the binary the application shipped.
- The native pipeline lifecycle E2E runs a typed minimap2-to-samtools workflow
  through the shared Jobs backend and verifies downstream file transfer,
  parent pipeline/run identity, and exactly-once Result provenance.
- The common execution-spine E2E runs FastQC directly through its in-process
  WASM Job and verifies progress, logs, cancellation, stable execution identity
  and exactly-once Results without affecting an earlier successful run.

The matrix is a product support boundary, not a claim that every upstream tool
publishes binaries for every desktop platform.
