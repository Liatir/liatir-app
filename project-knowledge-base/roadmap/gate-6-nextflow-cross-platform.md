# Gate 6 Nextflow cross-platform evidence

Verified: 2026-08-14. Re-proven unchanged on 2026-08-19 during the Gate 7 Windows/Linux
slice: the Windows app-to-WSL2 suite passed 3/3 with its restart companion at 2/2
phases, and the independently compiled Linux x86_64 app passed 3/3 under Xvfb.
No backend code changed; see
[Gate 7 Beta 1 — Windows and Linux evidence](./gate-7-beta1-windows-linux.md).
Starting revision: `8d6270846477988ef85cd32c435b389f05f8e4ad`

## Outcome

Gate 6 is cross-platform complete for the previously verified macOS arm64
backend, native Linux x86_64, and the native Windows x86_64 application using a
WSL2 Linux x86_64 execution backend. The Windows implementation is explicitly:

```text
liatir.exe -> wsl.exe -> /bin/sh run launcher -> Nextflow/Java
```

There is no `nextflow.cmd`, native Windows Nextflow installation, WSL
distribution termination, or alternate shared contract. macOS and Linux retain
their native POSIX backend.

## Ownership and implementation

The External Workflow Run is the state owner. Each run owns its staging tree,
engine work directory, launcher/control files, process token, workflow Job,
declared outputs, provenance, and restart reconciliation. A pipeline execution
adds `pipelineRunId` without changing that ownership. Standalone and pipeline
runs still call the same frontend adapter and shared definition.

On Windows the native bridge:

- probes the selected WSL distribution and rejects anything other than WSL2
  Linux x86_64 with usable Nextflow, Java, `wslpath`, `setsid`, `ps`, `grep`,
  `tr`, and `/bin/kill`;
- uses the default distribution unless the optional
  `LIATIR_WSL_DISTRIBUTION` value passes the strict distribution-name
  validation;
- creates one host-side run staging tree, copies and hashes source, optional
  config, parameters, and inputs, then converts validated absolute host paths
  through a fixed `wslpath` program receiving paths over standard input;
- writes LF-only run and launch scripts plus versioned runtime/control records,
  starts Nextflow in a fresh Linux session, and tags the tree with a random
  `LIATIR_WSL_RUN_TOKEN`;
- cancels only the token-matched process group with TERM, a bounded wait, and
  KILL escalation on the blocking worker pool, then waits for backend
  cancellation before finalizing the cancelled Job and Result without blocking
  unrelated UI or runs;
- scans only valid persisted control records on startup, stops a matching
  orphaned process group, and lets the common execution reconciler publish one
  interrupted Result with the original Job and parent identity;
- collects and hashes exact declared outputs back on the Windows host, while
  preserving the real WSL command, Linux runtime versions, mapped engine paths,
  logs, task evidence, and Liatir parent identities in provenance.

No source type in `packages/liatir-core` changed. The new runtime, execution
layout, and spawn structures are bridge-only types generated into the existing
SDK consumers.

## Verified platforms and toolchains

| Product path | Host/runtime evidence | Toolchain |
| --- | --- | --- |
| Windows app to WSL2 | Windows 11 Pro x86_64 `10.0.26200` (build 26200); WSL `2.7.10.0`; Ubuntu 26.04 LTS; kernel `6.18.33.2-microsoft-standard-WSL2`; Linux `x86_64` | Nextflow `26.04.6 build 12646`; OpenJDK `21.0.11`; Node `22.14.0`; npm `11.6.1` on Windows; Rust/Cargo `1.95.0` |
| Native Linux in WSL2 | Checkout `/home/lorenzo/liatir-stack-gate6` on the Linux filesystem, not `/mnt/c`; `uname -m` = `x86_64`; freshly built `src-tauri/target/debug/liatir` = `ELF 64-bit LSB pie executable, x86-64` | Ubuntu 26.04 LTS; Nextflow `26.04.6 build 12646`; OpenJDK `21.0.11`; Node `22.14.0`; npm `10.9.2`; Rust/Cargo `1.95.0` |
| macOS native | Existing Gate 6 evidence retained; shared native backend was not rewritten | macOS arm64; Nextflow `26.04.6 build 12646`; Java `21.0.11` |

## Exact verification results

### Native Windows app using WSL2

- `npm run test:tauri:prepare`: passed and produced a fresh Windows test app.
- `LIATIR_E2E_NEXTFLOW=1 node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/external-workflow-nextflow.e2e.mjs`:
  3 passed, 0 failed, 0 skipped. This covers direct success, the same definition
  twice in one pipeline, source/config/input staging and mapped paths, recorded
  command/environment, downstream output reuse, real failure, owner-scoped
  cancellation with no remaining token process, and reload reconciliation.
- `npm run external-workflow:test:wsl-restart`: both native-app phases passed.
  The first process left a real 120-second Nextflow tree with persisted run,
  Job, distribution, token, and control identity; the second app process stopped
  that exact tree and reconciled one interrupted Result, then proved idempotence
  after another reload.
- `npm run test:verify`: 51 test files, 296 tests passed.
- `cargo test`: 53 passed, 0 failed, 2 intentionally ignored Runtime Box
  fixtures.
- `cargo clippy --tests`: exit 0 with the pre-existing warning baseline.

### Repository-wide final checks

- `npm run docs:all:build`: both the public and internal VitePress sites built
  successfully.
- `git diff --check`: passed with no whitespace errors.
- Generated SDK/browser API consumers were rebuilt from their source, and the
  public documentation embedded in Quenta was regenerated on both platforms.

### Native Linux app inside WSL2

- `npm run test:tauri:prepare`: passed against the Linux-filesystem checkout.
- `file src-tauri/target/debug/liatir`: ELF 64-bit LSB PIE, x86-64.
- `LIATIR_E2E_NEXTFLOW=1 xvfb-run -a node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/external-workflow-nextflow.e2e.mjs`:
  3 passed, 0 failed, 0 skipped.
- `npm run test:verify`: 51 test files, 296 tests passed.
- `cargo test`: 52 passed, 0 failed, 2 intentionally ignored Runtime Box
  fixtures.
- `cargo clippy --tests`: exit 0 with the pre-existing warning baseline.

The fresh WSL checkout also required
`npm ci --prefix packages/liatir-cli` because two existing signing/runtime unit
suites intentionally import that package's local `jszip`; root `npm ci` alone
does not populate nested package dependencies.

No heavy AI model, GPU workflow, remote workflow, publication, release, or
deployment was run for this gate.

## Residual limitations

- Windows support means the native Windows Liatir app controlling Nextflow in
  WSL2 Linux x86_64. Native-Windows Nextflow, WSL1, and WSL ARM64 are not
  supported.
- Nextflow and a compatible Java must already be installed in the selected WSL
  distribution. Liatir does not yet manage their installation.
- The verified workflow uses the local executor and small local data. HPC,
  cloud, container, and remote executor setup remains outside this gate.
- Offline execution requires the workflow source and every workflow/runtime
  dependency to be present locally or already cached.
- The Windows host must expose the run staging path to the selected WSL
  distribution so `wslpath` and the Linux process can access it.
- Existing Clippy warnings remain technical debt; both platform runs completed
  with exit status 0.
