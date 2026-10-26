# Liatir — R & Native Plugin Runtime Support

## Objective

Implement two new first-class `.lia` plugin runtimes: **R** and **Native**, with full Liatir bridge access, SDK support, CLI integration, and seamless compatibility with the existing plugin and pipeline architecture.

The goal is to let developers create R/Bioconductor plugins or use virtually any compiled language (Rust, C++, Go, Zig, Fortran, etc.) without changing how Liatir nodes communicate.

## Non-negotiable requirements

- Preserve the existing Liatir I/O contract, field types, pipeline connections, Jobs, Results, provenance and file handling.
- R and Native must expose the **same bridge capabilities as Node and Python**: jobs, deps, desktop.fs, desktop.app, log, progress, paths and invoke.
- Preserve existing Node, Python and WASM behavior, including WASM's intentional isolation.
- Maintain offline execution, cross-platform compatibility and on-demand dependencies.
- Reuse existing infrastructure. Avoid parallel implementations, unnecessary abstractions and broad refactoring.

## Implementation

### Phase 1 — Extend shared contracts and CLI

Relevant code:
- `packages/liatir-core/src/index.ts`
- `packages/liatir-cli/src/commands/{init,build,dev}.ts`

1. Extend `LiatirPluginRuntime` with `r` and `native`, defining their runtime-specific manifest specifications.
2. Add `liatir init --r` and `liatir init --native`, with working minimal examples.
3. Extend `liatir build` to generate standard `.lia` bundles using the existing manifest, schema extraction, signing and packaging infrastructure.
4. Preserve code-declared I/O contracts and automatic schema generation. Do not introduce separate manually maintained schemas.
5. For Native, support platform-specific executable variants (OS + architecture) in the bundle, with deterministic target selection and clear unsupported-platform errors.

### Phase 2 — R runtime and SDK

Build an R SDK analogous to the existing Python SDK (`packages/liatir-cli/src/assets/liatir.py`).

- Provide CLI-managed `liatir.R` with plugin definition, field builders, validated inputs/outputs and handler execution.
- Support contract extraction using `Rscript` during build, avoiding execution of actual analyses.
- Execute R plugins through `Rscript --vanilla` as managed Liatir Jobs.
- Support CRAN and Bioconductor dependencies with isolated per-plugin libraries and reproducible dependency locking, preferably reusing `renv`.
- Detect compatible R installations and expose runtime readiness, dependency preparation and actionable errors in the Plugins UI. Investigate reuse of existing on-demand runtime provisioning so manual installation is not unnecessarily required.
- Implement `ctx$liatir` with typed wrappers for every existing Node/Python bridge namespace, plus raw `invoke`.
- Preserve structured results, logging, progress, cancellation and cleanup.

### Phase 3 — Universal Native runtime

Implement Native plugins as **separate executable processes**, not dynamically loaded shared libraries.

- Define a small, language-independent execution protocol using JSON input/output and the existing Liatir field schema.
- Support contract introspection at build time, a documented executable entrypoint, structured results and error reporting.
- Provide a lightweight Rust reference SDK/scaffold, while documenting the protocol so any compiled language can implement it without a language-specific SDK.
- Bundle executable variants within `.lia`; securely extract, select and execute the correct target.
- Reuse the existing Jobs lifecycle for spawning, stdout/stderr, cancellation, exit status and cleanup.
- Expose the complete Liatir bridge through the existing authenticated local IPC server. Native developers should be able to use typed SDK wrappers or implement the documented IPC protocol directly.
- Reuse existing bundle signing/integrity checks. Add explicit trust/permission handling for native executable code, without weakening existing security boundaries.

### Phase 4 — Backend and frontend integration

Relevant code:
- `src-tauri/src/bridge/lia_plugins.rs`
- `src-tauri/src/bridge/ipc_server.rs`
- `src-tauri/src/bridge/plugin_dev.rs`
- `frontend/src/lib/stores/lia-plugins.svelte.ts`
- `frontend/src/lib/utils/plugin-run.ts`
- `frontend/src/lib/tools/plugin-step.ts`

1. Extend `run_lia_plugin_bundle` with R and Native dispatch, preferably using a small shared subprocess helper instead of duplicating execution logic.
2. Reuse the authenticated IPC transport already used by Node/Python, injecting the correct bridge discovery and Job context into R/Native processes.
3. Preserve Plugin Dev Runner session isolation, workspace scoping and blocked-command protections.
4. Extend runtime detection, persistence, labels, readiness and error states in the UI. Unknown runtime values must fail explicitly, not silently fall back to Node.
5. Make both new runtimes work identically as standalone plugins and pipeline nodes, without runtime-specific pipeline logic.

### Phase 5 — Tests, examples and documentation

Add automated coverage for:

- `init → build → import → execute` for R and Native.
- Contract generation, input/output validation, bundle signatures and malformed manifests.
- Full bridge calls, including jobs, filesystem, dependencies, logging, progress and raw invoke.
- Cancellation, process failures, cleanup, missing dependencies and unsupported platform targets.
- Plugin Dev Runner isolation and permission boundaries.
- Regression tests for Node, Python and WASM.
- A mixed-runtime pipeline: **Node → R → Native → Python**, verifying identical I/O behavior and artifact handling.

Provide two useful example plugins: an R/Bioconductor statistical analysis and a Rust Native file-processing tool.

Update the plugin documentation, CLI reference and runtime compatibility guidance. Validate macOS, Linux and Windows, including executable permissions and platform packaging.

## Execution instructions for Codex

Before editing, read `AGENTS.md`, `.context/index.md`, relevant Syngraphe context and the actual implementations referenced above.

Implement incrementally in the order specified. Adapt details to existing conventions rather than forcing a new architecture. Keep changes focused and reusable. Do not stop at scaffolding or a design proposal: deliver functional end-to-end support.

Run relevant unit and integration tests, `npm run test:fast`, `npm run test:verify`, Rust checks, and `syngraphe check`. Execute available platform-specific tests; report any platform not actually validated.

Update `.context/` with the architectural decision, implementation progress and remaining limitations.

**Definition of done:** A user can create, build, install, develop and execute R or Native `.lia` plugins with full bridge access, use them interchangeably with existing tools in pipelines, and obtain the same Jobs, Results and provenance behavior without regressions.
## Implementation checkpoints (2026-10-26)

Branch: `feat/r-native-plugin-runtimes` (created from the current `main`, as authorized).

### Living execution checklist

- [x] Read repository policy, context, CLI packaging/signing, Python/WASM SDKs,
  runtime dispatch, IPC, Plugin Dev Runner, Jobs and pipeline settlement.
- [x] Shared contracts, strict runtime selection and CLI scaffolds/builds.
- [x] R SDK, isolated locked dependency preparation and runtime discovery.
- [x] Native executable protocol, Rust SDK reuse, target selection and bundle trust.
- [x] App dispatch, scoped dev lifecycle, Plugins readiness and pipeline integration.
- [x] Executable regression/integration coverage, examples and author documentation.
- [x] Fast/verify, Rust and native UI gates; record actual platform coverage.
- [x] Review intended diff and Syngraphe integrity; authorized commit is the final delivery action.

Execution rules: use existing bundle signing and Jobs cleanup; each run owns its
extracted payload and input file. Dependency environments are keyed by their locked
specification and interpreter identity, never by source-only edits. Native trust is
bound to the complete bundle SHA-256 and cannot be granted over plugin IPC. Dev runs
inherit the existing session context and remain tracked for session teardown.

Validation starts with focused SDK/CLI tests, then the required repository gates.
Stop a failing expensive gate at its first actionable blocker, document the cause,
and continue independent checks. No CI, releases, deployments or push are planned.

### Baseline findings

- Missing runtime means legacy Node; an explicitly unknown runtime must fail.
- Existing managed runtime provisioning is Python-specific; no reusable R installer
  or R Runtime Box is present. Discover compatible local R installations and surface
  an actionable missing-interpreter error; do not wire an unrelated AI box into Plugins.
- Syngraphe initially reports three LINK001 findings for ignored test report files in
  the testing overview. Replace these machine-local links with portable descriptions.
- This host is macOS arm64, has Rust/Node/Python, and initially has no Rscript on PATH.
  Linux/Windows execution requires those hosts and must not be claimed from this run.

### Checkpoint 1: shared contracts and executable SDKs

- CLI scaffolds and builds real R and Native projects; generated manifests retain
  the existing field schemas. Native targets are exact OS/architecture pairs.
- R packages are restored from bundled renv locks into interpreter/spec-keyed
  libraries; first author builds generate the lock without executing handlers.
- Native Rust reuses the WASM field/validation implementation, conditionally adding
  the HTTP bridge only for native targets. WASM remains isolated.
- Native trust receipts bind the complete immutable bundle bytes by SHA-256. Trust
  and R preparation are desktop-only commands. Bundle reads reject traversal,
  symlinks, duplicate entries, unknown runtimes and excessive expansion.
- New runtime readiness uses shared core types through the TypeScript bridge and
  generated browser SDK. Standalone and pipeline execution share the existing runner.
- Focused real tests: 15 Node/Python/WASM regressions passed; all seven new tests
  passed with R 4.6.1 and real Rust executables, including every SDK bridge namespace
  over authenticated HTTP and dev-context propagation. `cargo check --locked` passed.
- R validation uses an extracted, Apple-signature-verified official macOS package
  in ignored test artifacts; no global R installation was needed. Homebrew refused
  the host's older toolchain, so it was not used for runtime validation.
- The CLI initially exposed an unresolved private `@liatir/core` runtime import;
  fixed by bundling only its shared runtime helper into the public CLI build.
  Native `init -> build` now succeeds with the built CLI outside the source loader.

### Native UI regression investigation

The first required UI run built the real macOS app and passed 48 existing scenarios,
with 34 explicit platform/heavy/environment skips. The new Native execution scenario
failed with a terminal failed Job, before dev execution. Add structured Job/output
failure evidence to the test, reproduce only this spec, then fix the demonstrated
cause before repeating the broad gate. Retry limit: two focused attempts per cause.
The original seven-suite verify gate passed; lint now has zero errors (existing
warnings remain), and public documentation builds successfully.

Focused native-app reproduction identified two concrete failures:

1. IPC dependency dispatch required legacy `name`/`names`, while the canonical
   Node/Python SDK uses `binary`/`binaries`. Accept canonical fields and retain
   legacy aliases in that existing dispatcher; exercise both SDK runtimes in E2E.
2. R readiness embedded a whole JSON lock as R source in `Rscript -e`; Rscript's
   expression decoding corrupted escaped package metadata. Pass library and locked
   name/version pairs as literal arguments instead. No JSON or paths enter R source.

Both useful examples have now built and executed: real limma tested 30 genes and
returned adjusted p-values; the Native example counted two lines and four words.

The same focused review found two dev-boundary gaps in the existing IPC adapter:
raw Jobs listing was not filtered to the session, and plugin-specific filesystem
storage bypassed the session rewrite. Both now use session-owned namespaces;
per-job access also checks session identity. SDK plugin storage names normalize in
the same way as Node. Regression checks cover blocked trust/app lifecycle calls and
scoped storage alongside the successful runtime bridge calls.

Rust unit tests passed: 116 passed, 2 existing ignored tests. Focused SDK/CLI tests
now cover 24 passing cases, including signed Native byte tampering, multiple target
contracts, malformed manifests, file values and R validation failures. The public
site build passed. Further verification follows the IPC/R-probe fixes above.

### Checkpoint 2: real desktop runtime execution

The focused native macOS test now passes for both runtimes: bundle validation,
Native permission refusal/grant, R preparation and readiness, real filesystem,
dependency checks, app info, raw invoke, logs/progress, successful structured file
results, process failure, cancellation, private-run cleanup and scoped dev runs.
Both Plugins are also refused permission to grant their own Native trust; dev
calls to global app exit are blocked. The mixed-pipeline test exposed a test-only
rerun problem (its Python fixture folder survived the previous failing run); its
setup now clears only that test-owned fixture before scaffolding it again.

### Mixed pipeline regression and final review

The actual mixed pipeline exposed an existing contract mismatch: pipeline forms
serialize numeric and boolean values as text, while SDK handlers require typed JSON.
Node had tolerated this accidentally in the old dependency-free test fixture.
Fix it once in the shared core Plugin pipeline-input converter and call it from
the existing Plugin adapter for every runtime. Add regression cases for zero,
false, invalid values and blank optional fields; preserve file paths and strings.
This keeps the pipeline engine free of runtime branches. The test's seeded edges
must also contain the same `@pipe:` references that the real editor writes.

Final review also keys R libraries by Plugin name/version as well as lock and
interpreter, so different Plugins never share mutable libraries; code-only edits
still reuse their own library. Record the actual R runtime version and Native host
target in Job metadata. New runtimes fail visibly if they exit without a structured
output object instead of silently finalizing empty successful Results.

### Checkpoint 3: mixed pipeline and final verification

The real Node -> R -> Native -> Python pipeline now passes end to end with the
expected `NodeRNativePython` file, normal artifact persistence and pipeline Job
association. All three new native desktop scenarios passed without skips.
The common converter fixed the reproduced numeric/boolean transport defect;
field metadata is now copied from the shared schema instead of narrowed manually.
The latest fast and verify runs passed 90 unit files / 706 tests, and all seven
verify suites. The new protocol tests also observed missing-result refusal and
acceptance of the existing marker across all five runtimes.

### Remaining platform/distribution boundaries

- Actual execution evidence in this change is macOS arm64 only. Linux and Windows
  target mapping/packaging are tested as contracts; those hosts are not available
  here for native execution, executable-permission or install lifecycle proof.
- R interpreter discovery works with compatible installed R. A signed optional R
  interpreter distribution does not exist in this repository; it was not fabricated
  by repurposing an AI Runtime Box. Preparing locked packages may require network
  access and platform compilation tools; prepared execution is offline.
- Native executables must carry their runtime libraries or document system
  prerequisites. This implementation selects executable variants, not a second
  package manager for native shared libraries.
- The complete UI gate passed on macOS. Platform signoff is the reason this plan
  remains in state rather than being archived as cross-platform release evidence.

Final state-ownership review added a regression for category edits while readiness
is pending, plus workspace reset/late-response isolation. The old identity guard
was observed failing the category-edit test; both tests pass with task ownership.
The final full verify then caught TypeScript's definite-assignment check on the
immediately invoked async callback. Defer that request with `Promise.resolve().then`
so the map entry is installed before work starts, rather than asserting assignment.
All 708 tests passed before that frontend type failure; rerun the focused state
regressions and frontend check before repeating verify. The complete UI profile
has passed seven suites with two platform skips, including 51 native scenarios
and all three new subprocess/mixed-pipeline scenarios; Rust passed 119 tests
with two existing ignored cases, and Clippy passed with repository warnings.

## Delivery checkpoint

All feasible implementation phases are complete. Final evidence:

- `test:fast` passed; final `test:verify` passed all seven suites, with 91 unit
  files / 708 tests. The final verify report is `2026-10-26T04-37-10-043Z`.
- `test:ui` report `2026-10-26T04-07-26-083Z`: seven passed suites, zero failures,
  two platform skips (Windows/Linux install lifecycle). Ordinary native E2E:
  51 passed / zero failed / 32 explicit platform/heavy/environment skips.
- All three new native desktop scenarios passed, including the real mixed file
  pipeline. CLI `dev` session publication is also covered for R and Native.
- `cargo test --locked --features wdio`: 119 passed / zero failed / two existing
  ignored tests. `cargo clippy --locked --features wdio --all-targets` passed;
  repository warnings remain, with none in the new subprocess adapter.
- TypeScript lint has zero errors (existing warnings remain), the public docs
  build passed, and both useful examples executed with verified outputs.
- The readiness/category-edit regression was observed failing with its old guard;
  the corrected task-ownership guard and workspace reset tests both pass. Frontend
  check reports zero errors and warnings after deferring request startup.

The implementation revision is the feature-branch commit containing this checkpoint;
its exact SHA is supplied in the delivery message and recoverable from Git history.
The staged scope excludes test-only capability permissions, root dependency
lockfiles, credentials, trust roots, generated binaries and scientific study data.
No expensive CI, release, deployment, remote publication or push was performed.
Only the platform/distribution boundaries listed above remain; no local runtime
implementation blocker is known.

Cross-target contract metadata is generated automatically beside a host executable
and binds its code-declared schema to that executable's SHA-256. A cross-build
cannot silently package an older sidecar after rebuilding a binary: stale hashes
and unequal target schemas are both refused by executable CLI regression tests.
Unchanged generated metadata is not rewritten, avoiding development watch loops.

The final public CLI build also packaged and ran the Native scaffold successfully,
and its automatically generated contract metadata matched the executable bytes.

## Documentation integration follow-up (2026-10-26)

The public Plugin documentation is integrated across all five runtimes,
rather than leaving R/Native as an isolated appendix. The audit compared the
CLI build/init/update commands, managed R/Rust SDKs and backend JSON responses.

- [x] Add R/Native to runtime selection, prerequisites, initialization flags,
  authoring packages, complete entry points, field examples and handler contexts.
- [x] Document generated R/Native manifests, package locks, exact executable
  targets, generated cross-target metadata, permissions and temporary-output rules.
- [x] Add R and Native examples to each bridge capability and method reference;
  correct stale Job entry names, filesystem entry fields and binary/base64 docs.
- [x] Keep the CLI README aligned. State that both app and CLI need the new
  support without inventing a release version or claiming publication.
- [x] Validate extracted R examples and compile Native examples against the SDK.
- [x] Build the public docs, regenerate Quenta's documentation corpus and run
  the required verify profile.
- [x] Complete the Syngraphe integrity check (zero errors or warnings).

This follow-up changes documentation and generated documentation content only.
No runtime, dependency, version, deployment, release or remote action is required.

Documentation validation evidence:

- Public VitePress build passed, including generated Markdown and the AI indexes.
  All 12 method/capability pages preserve their R/Native tab content in the
  generated public Markdown.
- All 31 R snippets parsed successfully. The complete documented R and Native
  entry points ran with a Unicode input and emitted their version 1 contracts.
  All 16 Native Rust API example blocks compiled against the actual managed SDK.
- `test:verify` report `2026-10-26T14-35-17-032Z`: all seven suites passed,
  91 unit files / 708 tests, including real R SDK coverage. Quenta's documentation
  corpus was regenerated by the frontend prebuild step (376 chunks).
- No app UI or runtime implementation changed, so the previously passing native
  UI and Rust gates were not repeated for this documentation-only follow-up.

The optional internal-site build exposed two pre-existing links in current state
that treated Vue source files outside the context site as web pages. The files
exist and the links were unchanged from the parent revision. Render those two
references as code paths; retain all underlying homepage history. The single
internal-build retry passed after this bounded documentation correction. Final
Syngraphe integrity and whitespace checks also passed.

The documentation delivery stays on the current feature branch. Its commit
identity is supplied in the delivery message and recoverable from Git history.
