# Gate 8 MCP — Windows and Linux evidence handoff

Status: **Cross-platform complete on macOS arm64, native Windows x86_64 and
native Linux x86_64. The Windows app uses WSL2 only for the bundled Native Tool
process; the Linux proof uses an independently compiled ELF app.**

This is the platform-closing handoff for Scientific AI Workbench Gate 8. The
implemented product contract and threat model remain in
[Controlled local MCP boundary](../architecture/mcp.md); this document defines
the platform-closing executions and records their completed evidence.

## What the two platform proofs mean

The same Windows 11 x86_64 machine supplies two distinct product paths:

1. **Native Windows:** the MCP listener, authorization UI and saved-pipeline
   runtime belong to the real `liatir.exe`. A process-backed Native Tool invoked
   by that pipeline runs from Liatir's bundled `linux-64` environment through
   WSL2. This is Windows product evidence with a WSL2 execution backend, not
   Linux desktop evidence.
2. **Native Linux x86_64 inside WSL2:** an independent checkout lives in the
   Linux filesystem under `/home/...`, builds a real x86-64 ELF Liatir binary,
   and runs it under Xvfb. The MCP listener and the Native Tool both belong to
   that Linux application. No Windows executable and no checkout under `/mnt/c`
   count as Linux evidence.

WSL2 is therefore used for more than Nextflow. On Windows it is also the
supported execution backend for `samtools`, `bcftools`, `seqkit`, `fastp`,
`bwa` and `minimap2`, because bioconda has no `win-64` packages for them. The
native Linux proof uses the same `linux-64` bundle directly.

## Required MCP scenario

Keep `tests/e2e/specs/mcp.e2e.mjs` as the common real-client proof; do not create
a Windows-only MCP contract or a second test client. Its existing FastQC path
must continue to prove the complete MCP lifecycle and cancellation without a
heavy model or workflow. Add one small saved pipeline that executes the bundled
`seqkit-stats` Native Tool through MCP using a registered FASTQ artifact whose
host path contains a space.

The added execution must prove, on both platforms:

- the Native Tool's declared file and numeric inputs appear in the frozen MCP
  input schema and are supplied through `start_saved_pipeline`;
- the approval dialog shows the logical artifact and supplied value;
- one real SeqKit Job runs, reaches one terminal Result, and retains the MCP
  root identity and initiator through the existing execution spine;
- the parsed scientific output reports the expected record count;
- MCP status, logs, Job, Result and artifact resources remain path-free where
  the contract requires it;
- the saved pipeline remains unchanged after the execution.

On Windows, additionally assert that `lia_native_tools_environment` reports
`execution: "wsl2"`. The successful SeqKit result is then the end-to-end proof
of `MCP client -> native Windows MCP server -> saved pipeline -> Job -> WSL2
bundled tool -> Result`. The existing bundled-tool E2E remains the lower-level
proof for first-run extraction, a spaced Windows path, network-path refusal and
direct Job execution; do not duplicate all of those assertions inside MCP.

The existing full-surface schema/authorization fixture must continue to name
Native Tools, AI Tools and compatible installed AI Models, `.lia` Plugins,
External Workflows, viewers/utilities, API Connectors, Variable/Math/Condition
nodes and nested sub-pipelines. It intentionally denies that fixture before
execution: no heavy AI Model, GPU workload or non-trivial External Workflow is
required for this platform gate.

## Execution order

### Native Windows x86_64

Use the Windows checkout and native Node/Rust toolchain. Build the `linux-64`
Native Tools archive inside WSL2 first; Windows verifies and packages those
bytes but cannot link that environment itself.

Run, in order:

```text
wsl node scripts/build-native-tools-env.mjs
npm run test:verify
npm run test:tauri:prepare
node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/mcp.e2e.mjs
npm run test:ui
cd src-tauri
cargo test
cargo clippy --tests
```

The targeted MCP scenario must be reported separately even when the full UI
profile also includes it. Record the Windows version, WSL version and selected
distribution, `uname -m`, Node/npm/Rust versions, Native Tools archive digest,
the targeted MCP count and the complete UI profile result.

### Native Linux x86_64 inside WSL2

Use an independent checkout under `/home/...`, not the Windows checkout through
`/mnt/c`. Confirm that `uname -m` is `x86_64`, build the bundle and Tauri app
there, and confirm with `file` that the executable is an `ELF 64-bit ... x86-64`
image. Run GUI tests under Xvfb:

```text
npm run test:verify
npm run test:tauri:prepare
xvfb-run -a node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/mcp.e2e.mjs
xvfb-run -a npm run test:ui
cd src-tauri
cargo test
cargo clippy --tests
```

Record the distribution/kernel, `uname -m`, Node/npm/Rust versions, `file`
output for the app, Native Tools archive digest, targeted MCP count and complete
UI profile result.

## Completion evidence — 2026-08-22

The common `tests/e2e/specs/mcp.e2e.mjs` scenario still uses
`@modelcontextprotocol/client` 2.0.0. It now adds the saved
`gate-8-mcp-seqkit` pipeline to the existing FastQC and complete-input-surface
fixtures. The test writes a 17-record FASTQ below a host directory whose name
contains a space, registers it in Data, supplies its artifact ID plus numeric
`threads: 3`, and verifies both declared fields in the frozen MCP schema and in
the approval dialog. The approved run executes SeqKit, produces exactly one
Job and one terminal Result, retains the root ID and `initiator.kind = "mcp"`
through the Pipeline Run, Native Tool child, Job and Result, reports 17
sequences, keeps all public MCP resources sanitized, and leaves the saved
pipeline byte-for-byte unchanged. FastQC still covers success, cancellation,
denial and stale/revoked grants. The denied complete fixture still explicitly
covers Native Tools, AI Tools plus compatible installed AI Models, `.lia`
Plugins, External Workflows, viewers/utilities, API Connectors,
Variable/Math/Condition and nested sub-pipelines without starting a model or
workflow.

### Native Windows x86_64

- Host: Microsoft Windows 11 Pro x86_64, version `10.0.26200`, build
  `26200.9168`.
- WSL: `2.7.10.0`, default distribution `Ubuntu` version 2; Ubuntu 26.04 LTS,
  kernel `6.18.33.2-microsoft-standard-WSL2`, `uname -m` = `x86_64`.
- Native toolchain: Node `v22.14.0`, npm `11.6.1`, rustc
  `1.95.0 (59807616e 2026-04-14)`, cargo
  `1.95.0 (f2d3ce0bd 2026-03-21)`.
- `wsl node scripts/build-native-tools-env.mjs`: passed. The verified
  `linux-64` archive is `97,679,085` bytes with SHA-256
  `c5698ccd54d586d5411186d65645dd43c6113c347ecf8048e46076b76acd7579`;
  lock SHA-256 is
  `e0bcda684beb347012f3305bdfe3347205ff09134f75862ee1339cfe9d26b25a`.
  It contains SeqKit 2.13.0 plus samtools/bcftools 1.24, fastp 1.3.6, bwa
  0.7.19 and minimap2 2.31.
- `npm run test:verify`: passed, 57 files / 342 tests, plus SDK generation,
  core/frontend builds and `src-ts` compilation.
- `npm run test:tauri:prepare`: passed and built the real
  `src-tauri/target/debug/liatir.exe`.
- `node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/mcp.e2e.mjs`: passed,
  1/0/0. The scenario asserts
  `lia_native_tools_environment().execution === "wsl2"`; its successful
  17-record SeqKit Result therefore proves
  `official MCP client -> liatir.exe MCP server/approval -> saved pipeline ->
  Job -> WSL2 bundled SeqKit -> Result`.
- `npm run test:ui`: passed, 5 suites / 0 failed / 2 platform-skipped; its
  native Tauri E2E sub-run is 33 passed / 0 failed / 23 skipped.
- `cargo test`: 80 passed / 0 failed / 2 ignored. `cargo clippy --tests`:
  exit 0 at the existing warning baseline.

### Native Linux x86_64 inside WSL2

- Independent checkout:
  `/home/lorenzo/liatir-stack-gate8-mcp`; it never used `/mnt/c` as its
  working tree and carried the same source revision and change set as Windows.
- Host: Ubuntu 26.04 LTS, kernel
  `6.18.33.2-microsoft-standard-WSL2`, `uname -m` = `x86_64`.
- Native toolchain: Node `v22.14.0`, npm `10.9.2`, rustc
  `1.95.0 (59807616e 2026-04-14)`, cargo
  `1.95.0 (f2d3ce0bd 2026-03-21)`.
- The targeted MCP run used a freshly built `linux-64` archive of
  `97,961,846` bytes, SHA-256
  `7ba2d34aabc24f50edc03e1716cad72a29d7290d4abbc67027d83e8728386d6d`.
  The final UI profile rebuilt the same locked six-tool environment as
  `97,959,683` bytes, SHA-256
  `76c6da0326da2a49d19600666d9ee6db5fb3667c88fa2576f4c37b2c6c197170`;
  both manifests use lock SHA-256
  `e0bcda684beb347012f3305bdfe3347205ff09134f75862ee1339cfe9d26b25a`.
- `file src-tauri/target/debug/liatir`: `ELF 64-bit LSB pie executable,
  x86-64, version 1 (SYSV), dynamically linked, interpreter
  /lib64/ld-linux-x86-64.so.2, for GNU/Linux 3.2.0`, not stripped (final
  BuildID `ae9c29d9c26002cde7612f9aa56d734a28f43194`).
- `npm run test:verify`: passed, 57 files / 342 tests, plus all build/type
  gates. A fresh clone first needed the known nested prerequisites
  `npm ci --prefix packages/liatir-cli` and `npm ci --prefix frontend`; root
  `npm ci` alone does not create those package-local modules or SvelteKit
  metadata.
- `npm run test:tauri:prepare`: passed and built the bundle and ELF app.
- `xvfb-run -a node tests/e2e/run-tauri-e2e.mjs
  tests/e2e/specs/mcp.e2e.mjs`: passed, 1/0/0. The scenario asserts
  `lia_native_tools_environment().execution === "native"`, so SeqKit ran
  directly from the bundled Linux prefix owned by the Linux app.
- `xvfb-run -a npm run test:ui`: passed, 5 suites / 0 failed / 2
  platform-skipped; its native Tauri E2E sub-run is 33 passed / 0 failed / 23
  skipped. Ubuntu 26.04's `/usr/bin/python3` is 3.14.4, outside the Python
  fixture's declared `>=3.10,<3.14` range. The first profile correctly refused
  it; the green run placed an isolated Pixi Python 3.12.14 environment first
  on the runner `PATH`, without changing the product requirement or system
  Python.
- `cargo test`: 79 passed / 0 failed / 2 ignored. `cargo clippy --tests`:
  exit 0 at the existing warning baseline.

### Defects and regressions

1. SeqKit's default aligned table does not quote its first `file` column. A
   path containing spaces shifted every scientific column in Liatir's parser.
   The parser now preserves tabular `-T` output and, for the aligned form,
   rejoins only excess leading fields into the file column. The new
   `seqkit-output-parser.test.ts` regression verifies the path and all numeric
   values, including 17 sequences.
2. Windows SeqKit prints the mapped WSL path (`/mnt/c/...`), while the MCP
   sanitizer knows the registered Windows path. An otherwise unrecognized
   absolute-path scalar could therefore cross a public status/log/Result
   resource. Sanitization now replaces such a scalar with
   `[absolute path redacted]`; the Rust regression covers both WSL and Windows
   absolute paths while preserving a safe scientific line.
3. The first Windows E2E attempt reached the completed SeqKit child and exposed
   a new test expectation that called it `pipeline-step`; the canonical
   execution identity is correctly `native-tool`. Only the assertion changed,
   and the targeted scenario then passed.

No shared WSL bridge, process execution or cancellation logic changed, so the
conditional Nextflow rerun was not required. No heavy AI test, release,
publication, signing, deployment, remote workflow or GPU workflow was run.

## Exit criteria

Gate 8 is cross-platform complete because all of these are concrete:

- the current `npm run test:verify` passes after the test change;
- the official TypeScript MCP client scenario passes against native Windows;
- its real SeqKit execution proves the Windows app-to-WSL2 Native Tools path;
- the same scenario passes against a freshly built native Linux x86_64 ELF app
  inside WSL2 and executes SeqKit natively there;
- both full UI profiles are green, or any infrastructure-only failure is
  recorded exactly and the gate remains open rather than inferred green;
- `cargo test` and `cargo clippy --tests` pass on both operating systems at the
  repository's accepted warning baseline;
- the evidence and any defects found are written back to this handoff,
  `current-project-status.md`, `beta-readiness.md`, the canonical workbench plan
  and its Italian realignment.

Do not claim remote MCP, native-Windows bioinformatics binaries, WSL1, WSL ARM64,
heavy AI Model execution, signing or publication. The Windows MCP server is
native; only the selected pipeline runners cross into WSL2.
