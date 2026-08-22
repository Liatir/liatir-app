# Gate 8 MCP — Windows and Linux evidence handoff

Status: **macOS arm64 is verified. Native Windows x86_64 and Linux x86_64
runtime evidence remain open.**

This is the platform-closing handoff for Scientific AI Workbench Gate 8. The
implemented product contract and threat model remain in
[Controlled local MCP boundary](../architecture/mcp.md); this document defines
which executions are still required before the gate can be called
cross-platform complete.

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

## Exit criteria

Gate 8 becomes cross-platform complete only when all of these are concrete:

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
