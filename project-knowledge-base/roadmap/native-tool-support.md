# Native Tool Support Matrix

> **Superseded in direction (2026-08-20).** The maintainer decided that every
> Native Tool ships inside the app, in a single relocatable environment per
> operating system, and that a tool with no package for a platform is declared
> unsupported there instead of being handed to the user as a package-manager
> instruction. The matrix below
> still describes what ships today and stays authoritative until the migration
> lands; the "Package manager" column is what the decision removes. See
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
| bwa-mem2 2.3 | Package manager | Package manager | Managed | Package manager | Package manager |
| samtools | Package manager | Package manager | Package manager | Package manager | Package manager |
| bcftools | Package manager | Package manager | Package manager | Package manager | Package manager |
| fastp | Package manager | Package manager | Package manager | Package manager | Package manager |

SnpEff remains a modular Java/JAR runtime with its databases managed
separately. Direct and pipeline annotation use the same Jobs execution path.

## Verification gates

- Unit tests reject release records without immutable HTTPS URLs, versions,
  byte sizes, SHA-256 digests, or verification dates.
- The heavy native dependency E2E downloads the real SeqKit release, verifies
  it during installation, resolves it by bare tool name, executes
  `seqkit version`, and removes it from isolated test storage.
- The native pipeline lifecycle E2E runs a typed minimap2-to-samtools workflow
  through the shared Jobs backend and verifies downstream file transfer,
  parent pipeline/run identity, and exactly-once Result provenance.
- The common execution-spine E2E runs FastQC directly through its in-process
  WASM Job and verifies progress, logs, cancellation, stable execution identity
  and exactly-once Results without affecting an earlier successful run.

The matrix is a product support boundary, not a claim that every upstream tool
publishes binaries for every desktop platform.
