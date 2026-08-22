# Native Tool Support Matrix

> **Rewritten 2026-08-22.** This page used to describe a managed release
> registry: upstream binaries pinned by version, byte size and SHA-256, installed
> on request from the Dependencies screen. That registry and its installer were
> deleted the same day, because every platform Liatir supports now carries the
> tools inside one signed Scrollcase box. The history is in
> [Native Tools as one Scrollcase box](./native-tools-bundled-environment.md);
> what follows is the support boundary as it now stands.

Liatir resolves every pipeline and standalone Native Tool through the shared
Jobs backend, which keeps execution, cancellation, logs, parent pipeline identity
and provenance consistent however a tool is reached.

Resolution has two sources and no third. An explicit path is used verbatim. A
tool the application bundles resolves to the verified Native Tools box. Anything else
falls through to `PATH`. The middle case is the whole product: the user installs
nothing, and what runs is the build the release was tested against.

## Current support matrix

| Tool | macOS arm64 | Linux x86_64 | Windows x86_64 |
| --- | --- | --- | --- |
| samtools | Scrollcase box | Scrollcase box | Linux Scrollcase box, through WSL2 |
| bcftools | Scrollcase box | Scrollcase box | Linux Scrollcase box, through WSL2 |
| seqkit | Scrollcase box | Scrollcase box | Linux Scrollcase box, through WSL2 |
| fastp | Scrollcase box | Scrollcase box | Linux Scrollcase box, through WSL2 |
| bwa | Scrollcase box | Scrollcase box | Linux Scrollcase box, through WSL2 |
| minimap2 | Scrollcase box | Scrollcase box | Linux Scrollcase box, through WSL2 |
| FastQC | In-process WASM | In-process WASM | In-process WASM |
| SnpEff | Java on `PATH` | Java on `PATH` | Java on `PATH` |

Those are the three platforms Liatir ships. macOS x86_64 is not a target and will
not become one; Linux ARM64 has no application, so it has no box target either.

SnpEff is the one exception, and deliberately: it is a Java program whose
databases are managed separately, so bundling it would mean bundling a JRE that
outweighs all six tools combined. Java is therefore the only dependency a user of
a supported platform can still be asked to install for a Native Tool.

## Verification gates

- Scrollcase builds from committed per-target locks, runs every tool through the
  authored self-test, signs the release and verifies the finished archive. It
  fails if one does not work or reports a version the lock did not pin, so a
  green build has executed all six rather than merely downloaded them.
  `.github/workflows/native-tools-box.yml` does this on `ubuntu-24.04` and
  `macos-15`.
- Contract tests hold both scrolls, both locks, product metadata, the TypeScript
  contract and the Rust resolver in agreement — surfaces that cannot see each other, where
  a tool missing from one produces no error, only a silent fall-through to
  `PATH`.
- The Dependencies E2E proves that a bare tool name spawned through the shared
  Jobs backend runs the binary the application shipped, at the version its
  box metadata records, including a path containing a space; on Windows it also
  proves a network location is refused with an instruction rather than forwarded.
- The native pipeline lifecycle E2E runs a typed minimap2-to-samtools workflow
  through the shared Jobs backend on the real bundled tools, and verifies
  downstream file transfer, parent pipeline/run identity, cancellation of a real
  process, and exactly-once Result provenance.
- The common execution-spine E2E runs FastQC directly through its in-process
  WASM Job and verifies progress, logs, cancellation, stable execution identity
  and exactly-once Results without affecting an earlier successful run.

This matrix is a product support boundary, not a claim about every computer that
may happen to run Liatir.
