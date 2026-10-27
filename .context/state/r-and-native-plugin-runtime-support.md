# Liatir — R & Native Plugin Runtime Support

## Objective

Implement two new first-class `.lia` plugin runtimes: **R** and **Native**, with full Liatir bridge access, SDK support, CLI integration, and seamless compatibility with the existing plugin and pipeline architecture.

The goal is to let developers create R/Bioconductor Plugins and use the supplied Rust/C++ libraries for Native/WASM Plugins without changing how Liatir nodes communicate. The owner narrowed public language support to the libraries actually provided; a generic execution protocol does not imply a supported SDK for other languages.

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

## Main integration review (2026-10-26)

The owner authorized merging the complete feature branch into local `main`,
superseding the original branch-only delivery boundary. Remote `main` was fetched
and matches local `main`; the candidate includes runtime implementation
`aeacb806`, the owner's architecture illustration update `a08fb663`, and complete
Plugin documentation `449964c1`.

- [x] Review the branch diff, shared runtime selection and CLI packaging, public
  Plugin guides, bridge references, examples and architecture illustration.
- [x] Correct the introductory runtime list and add R/Native prerequisites and
  troubleshooting to the general architecture/support pages.
- [x] Refresh both documentation builds and generated Quenta content after the
  bounded correction; complete verify and Syngraphe before local integration.

The documentation defect was an older three-runtime sentence outside the Plugin
section. Cheap rechecks cover every public runtime enumeration and generated
Markdown; one docs rebuild after the correction and the required verify gate
are sufficient. Linux/Windows runtime execution limitations remain unchanged.

Final integration checks passed: `test:verify` report
`2026-10-26T15-00-00-661Z` has seven passed suites and 708 unit tests; both
VitePress sites build, generated public Markdown includes the introduction and
support corrections, and Syngraphe reports no problems. The source SVG was also
rendered locally and its five Plugin runtime boxes inspected. Quenta's generated
documentation corpus matches the final public sources (376 chunks).

The reviewed revision is ready for a local fast-forward into `main`; the branch
has no competing main commits after fetching origin. The user's authorization
covers the complete branch, including their infographic commit. No CI, release,
deployment or remote push is part of this integration. The final main identity
and clean working-tree state are verified directly after the Git operation.

## Uniform runtime documentation correction (2026-10-26)

The owner rejected a separate combined runtime guide: R and Native must be
first-class variants in the existing Plugin documentation, like Node, Python
and WASM. The initial extra page was an incorrect documentation organization
choice. The convention is now recorded in shared repository conventions.

- [x] Remove the extra page and its sidebar entry; keep all unique dependency,
  executable protocol, target/security and bridge transport details in the common
  getting-started, bundle-format and API-bridge guides.
- [x] Update inbound links across the API, overview, authoring, support and CLI
  documentation. Present bridge capabilities uniformly across supported languages.
- [x] Recheck the shared contract: core owns field/result types, CLI serializers
  emit those schemas, imported R/Native manifests validate field types, supplied
  R/Rust SDKs validate values, and the existing pipeline/result path is reused.
  Custom Native clients implement that same contract and validation themselves.
- [x] Regenerate Quenta, build both documentation sites, run the required verify
  gate with real R coverage and Syngraphe.

No runtime code, schema version, dependency, release or remote action changes.
The existing mixed-runtime execution and invalid-input tests provide contract
regression coverage; this correction changes only documentation organization.

Validation passed: verify report `2026-10-26T18-10-00-206Z` has seven passed
suites, 91 unit files / 708 tests with the real R SDK enabled. Both documentation
sites build. The removed public route is absent from built pages, sitemap,
Markdown and AI indexes; no inbound links remain. Dependency, executable and
bridge protocol details remain in the common guides. Quenta now contains 374
documentation chunks. Syngraphe and whitespace checks pass. The correction is
committed on local `main`; its identity is supplied in the delivery message.

## Compiled-language API examples (2026-10-26)

The owner requested `Native/WASM` runtime tabs with nested Rust/C++ examples and
a short language-compatibility notice above them. Runtime choice must not imply
Rust is mandatory. Bridge API notices still distinguish Native access from the
isolated WASM runtime.

- [x] Replace compiled-language tabs across bridge, field, context and entry-point
  guides, preserving existing Node/Python/R examples and the shared contract.
- [x] Supply actual C++ examples through the existing protocol. The downloadable
  documentation client uses libcurl and nlohmann/json; neither becomes an app
  dependency or a CLI-managed SDK. C++ compilation stays author-managed.
- [x] Compile all 34 C++ fragments; execute all 31 bridge examples against an
  authenticated local fixture (202 requests), including development scoping,
  terminal failures and rejected malformed credentials. Run the complete C++
  entry point with Unicode, defaults, invalid inputs and contract introspection;
  package its actual executable successfully with the existing CLI.
- [x] Preserve nested language headings in generated Markdown. The regression was
  observed failing with the old flattening; all 11 Markdown tests pass after the
  depth-aware fix. Fix a previously unclosed code-group in the Jobs run example.
- [x] Verify nested selection and small-screen rendering in the built site,
  regenerate Quenta, run both docs builds, full verify and Syngraphe.

The first C++ compile check found a fixture parameter shadowing a snippet-local
variable; compile fragments in their own nested block. The first site build
correctly rejected a Markdown link to an unrecognized header extension; use a
real HTML download link to the existing static header and verify HTTP delivery.
Both bounded corrections passed their cheap rechecks; do not bypass link checks.
No runtime, shared schema, lockfile, release or remote publication changes.

Final evidence: a local browser verified 34 nested runtime selectors across 16
API/authoring pages, Rust/C++ order, notice placement, independent parent/child
selection, the real C++ header download and a narrow viewport. All 12 bridge
reference Markdown pages preserve the nested language headings. The complete
verify profile passed all seven suites in report `2026-10-26T18-50-31-382Z`:
91 unit files / 709 tests, including the added Markdown regression and real R
coverage. Both VitePress sites build, and Quenta's 374 chunks were regenerated.
The C++ examples were compiled/executed as macOS Native processes; no C++ WASI
cross-toolchain or other-platform execution is claimed by these checks. Existing
Rust/WASM support and the shared I/O contract are unchanged. The correction is
committed on local main with no publication or remote push.

## Remote push authorization (2026-10-26)

The owner requested pushing all completed work. Fetched `origin/main` is
`e7f6a929`, an ancestor of the reviewed local `59052590`; there is no competing
remote history. The push targets `Liatir/liatir-app`, `refs/heads/main`, without
force or tags. The configured public SDK mirror will run because the CLI README
changed; Runtime Box/GPU and desktop-release workflows do not match this push.
Existing verification covers the delivered code; this final context update
records the authorization. Verify the remote ref against local main immediately
after the push. No manual release, deployment or CI dispatch is requested.

## Managed C++ SDK and supported-language scope (2026-10-26)

The owner requested a real CLI-managed C++ SDK, including automatic shared I/O
validation, and removal of claims that arbitrary compiled languages are supported.
The existing C++ download is only a bridge example and is not sufficient.

Implementation checklist:

- [x] Add C++ as an explicit Native/WASM authoring choice, retaining Rust defaults
  and every existing scaffold. Supply managed contract/bridge headers and a small
  entry point; update them with the existing managed-asset mechanism.
- [x] Reuse the current manifest/contract extraction, signatures, target selection,
  Dev Runner, Jobs and Results. Add a CMake author build path for C++17; Native
  links libcurl, WASM uses WASI Preview 1 and excludes the bridge. Build options
  stay author-side and are not added to the runtime bundle contract.
- [x] Validate declared types/defaults, required inputs/outputs, file/JSON/stats
  results and undeclared outputs before accepting success. Test the actual
  compiled Native and WASM SDKs and CLI build/dev behavior, including failures.
- [x] Replace the manual C++ documentation client with the managed SDK. Keep
  Rust/C++ nested tabs and describe only the supplied language libraries. Update
  the common guides, examples, repository conventions and generated Quenta data.
- [x] Run focused regressions, required verify, docs builds, relevant desktop
  integration checks and Syngraphe.

Author prerequisites remain modular: CMake/compiler and C++ dependencies are
needed only to build C++ Plugins; WASI SDK is needed only for the C++ WASM target.
No new app-start dependency, shared I/O type, format version, root lockfile,
release, publishing action or paid CI is authorized by this implementation task.
Local validation tools may be downloaded into ignored test artifacts, without
changing the user's system installations. A missing author toolchain must fail
with an actionable message; never silently fall back to another language.

C++ implementation checkpoint: both real Native and WASI builds succeeded, and
all new behavioral checks passed except a macOS fixture path comparison (`/var`
versus `/private/var`). Normalize that assertion through `realpath`, as the
existing Rust SDK tests already do. The WASI SDK's CMake platform did not retain
its executable suffix, so set `.wasm` explicitly on the generated target; the
subsequent real build and contract extraction succeeded. C++ WASM uses the SDK
failure path without a C++ exception runtime, preserving Preview 1 compatibility.
Native contract, bridge, SDK refresh, development lifecycle and actual WASM
execution are covered by the focused compiled SDK suite. Retry the focused suite
once after the fixture correction, then use the required repository gates.

Validation checkpoint: the focused SDK suite passed all eight cases, including
actual Native and WASI Preview 1 compilation/execution and the normal CLI dev
lifecycle. A raw-JSON handler regression was observed failing when the SDK's
value checks were deliberately disabled; checks were restored before the clean
public CLI build. The built CLI's managed headers match their source assets.
Two new native desktop cases passed (zero skips): C++ Native bridge/contract/dev
ownership, and a C++ Native -> C++ WASM file pipeline with Results association.
No Rust/Tauri/frontend runtime code changed, so those cases use the existing
WebDriver-enabled binary with the same app-side execution code.

Compiler-dependent unit and desktop checks opt in through `LIATIR_CMAKE`
(and `WASI_SDK_PATH` for C++ WASM), keeping optional author dependencies out of
ordinary verification environments. CLI flag/scaffold and unsupported-language
regressions always run. Final local gates enable the full author toolchain.

C++ SDK delivery evidence:

- Final verify report `2026-10-26T21-07-17-909Z`: all seven suites passed,
  92 unit files / 718 tests. Real R, Native C++ and WASI C++ checks were enabled.
- Both public/internal documentation sites build. All 34 compiled-language tab
  selectors across 16 API/authoring pages were checked in the browser, including
  nested selection, notice placement and a narrow viewport. All 34 C++ snippets
  compile against the managed headers; the documented complete entry point also
  compiles. Public docs no longer promise arbitrary-language support.
- Native desktop integration passed two new cases with zero skips/failures:
  authenticated C++ bridge plus required-input failure/dev ownership, and a real
  Native C++ -> WASM C++ file pipeline with Jobs and Results associations.
- The useful C++ file-summary example built and ran, returning a JSON report
  counting two input lines through the standard file-output contract.
- SDK source/assets match the built public CLI. TypeScript lint has zero errors
  and 56 existing warnings. The only new lint error was object stringification in
  an unsupported-language diagnostic; it now reports a string value or its type,
  and the full verify gate was repeated successfully after the correction.
- Syngraphe integrity and whitespace checks pass. No Rust/Tauri runtime change,
  lockfile, app version, trust root, expensive CI or publication is involved.
  Native host execution was verified on macOS arm64; Linux/Windows execution
  remains a platform signoff boundary, as already recorded for these runtimes.

The completion revision is committed on the current local branch; its exact
identity is supplied in the delivery message and recoverable from Git history.
Publishing the updated CLI package is a separate release action.

Final source review found an author-SDK path issue worth fixing before delivery:
JSON paths are UTF-8, while Windows environment paths are UTF-16. Use UTF-8
filesystem conversion for declared file inputs and the wide environment API for
Native input/connection files. Add Unicode input filenames to the compiler and
desktop pipeline checks, then rerun those checks and final gates once. This does
not claim Windows execution signoff; it avoids baking a known narrow-path
assumption into the new SDK. The change is limited to C++ headers and fixtures.

The Unicode-path correction passed the final verify rerun (all seven suites,
718 unit tests), both Native desktop cases again (zero failures/skips), and
source/packaged-CLI asset consistency checks. SDK npm dry-run inspection verified
the exact `@liatir/cli` package identity and all four new C++ assets; no package
was published. All implementation checkpoints are complete on macOS arm64,
with other-host signoff and the separate package release still outstanding.

## Desktop distribution follow-up (2026-10-27)

The owner separately authorized desktop 0.3.0 publication. The existing release
workflow built macOS arm64, Linux x86_64 and the Windows Store MSIX successfully
at revision `622647f806a52bb71de88dafff94d0212ceb4600`; verified macOS/Linux downloads
and their signed updater feed are now public. A clean-checkout unit-test
prerequisite was fixed in the common command before the successful run. See the
[release evidence](./roadmap/release-signed-distribution.md).

The Store package is verified but still needs manual Partner Center submission
and certification. Publishing the new CLI/SDK package remains a separate action;
this desktop release did not publish npm packages. Linux/Windows build success
does not replace the still-open execution signoff for the new Plugin runtimes.

## npm 1.10.0 publication checkpoint (2026-10-27)

The owner separately authorized publishing `@liatir/api` and `@liatir/cli` at
1.10.0 using npm account `suffro`. Both are now public with `latest=1.10.0`.
This does not change desktop version 0.3.0 or the shared Plugin contract.

- [x] Read the publication helper/lifecycle definitions and verify account and registry.
  Its existing preparation synchronized package/lock identities and scaffold ranges.
- [x] Pass `liatir:publish:dry -- --version 1.10.0 --tag latest` for both identities;
  confirm managed SDK source/asset consistency and restoration of temporary edits.
- [x] Pass all seven verify suites (718 unit tests, report
  `2026-10-27T01-10-52-641Z`) and Syngraphe before publication.
- [x] Publish API before CLI to `https://registry.npmjs.org/`, public access and
  `latest`, and read back name, version, latest tag, publisher `suffro`, tarball URL
  and hashes. npm's processing delay completed for both packages.
- [x] Commit synchronized release version metadata as `42e59dec`; this final context
  checkpoint records the public publication evidence alongside the released source.

The first attempt failed with npm E404 after browser authentication because
`suffro` lacked effective package permission at that point. The scope-level access
query had been insufficient; the collaborator listing identified `liatir.com`.
The owner then explicitly requested retrying with `suffro` after updating access.
The retry succeeded, and public metadata identifies `suffro` as publisher for both
packages. No account protection was weakened and no package was unpublished.
The npm CLI renders `_npmUser` as a display string here; normalize its username.

Registry tarball shasums match those reported for the built publication packages:

| Package | Version / latest | Publisher | SHA-1 |
| --- | --- | --- | --- |
| `@liatir/api` | `1.10.0` | `suffro` | `b82096d4ff2fa2806e3138b2a0f82f290c094e4f` |
| `@liatir/cli` | `1.10.0` | `suffro` | `e3b1c8440cd6fbb6436c0638c9ee347d27a72fd0` |

Public registry readback also records each SHA-512 integrity value. The CLI's 41
published files include all managed R, Rust and C++ SDK assets. The owner explicitly
requested no additional broad checks: fresh archive-install/build smoke tests and
additional CI were intentionally skipped, using the existing implementation and
release validation. No GPU, heavy-model, desktop-release or deployment workflow
was manually started for this npm release. Other-host runtime execution signoff
and Microsoft Store certification remain separate from npm distribution.
