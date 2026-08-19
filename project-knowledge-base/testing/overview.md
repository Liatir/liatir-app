# Testing Liatir

Liatir is a local Tauri desktop app. Production-grade tests must exercise the
native bridge whenever a feature depends on filesystem access, dependencies,
jobs, AI runtimes, viewer capture, sidecars, or `.lia` execution.

## Test Layers

- `npm run test:fast`
  Runs the test matrix fast profile. Today this is the unit/contract layer and
  writes a JSON and Markdown report under `tests/.artifacts/reports`.

- `npm run test:verify`
  Runs the production handoff profile: unit tests, SDK type generation, core
  build, frontend check, frontend build, and root TypeScript compile. This is
  the default non-native quality gate for regular implementation work.

- `npm run test:ui`
  Runs the matrix native UI profile. It prepares a Tauri WebDriver-enabled test
  binary and runs native E2E specs against the real desktop webview.

- `npm run test:ui:visual`
  Runs the matrix visual profile. It prepares the Tauri test binary and runs the
  visual screenshot comparison suite.
- `npm run test:visual:update`
  Intentionally replaces visual baselines using the current Tauri test binary.
  Normal visual runs fail when a baseline is missing instead of silently
  creating one.

GitHub Actions runs the repository CI weekly, on manual dispatch, and for pull
requests that change code. Direct pushes to `main` are intentionally covered by
the weekly batch instead of starting a macOS runner for every small commit.

Runtime Box workflows have their own trigger and cost policy and are not
described by that general rule. Heavy model-native jobs resolve to reviewed
on-demand self-hosted runner profiles; hosted jobs are coordination/preflight
only. The older foundation workflow still has path-filtered push/schedule
triggers and a standard hosted OS fixture matrix. Its relationship to the P5
Scrollcase adapter changes is currently under review: do not widen or trigger
that matrix as an incidental consequence of a normal push, and never treat a
queued job as authorization to start a self-hosted runner.

- `LIATIR_RUN_HEAVY_AI=1 npm run test:heavy:ai`
  Runs the gated heavy AI profile. This can exercise large AI Model catalog
  checks and, when `LIATIR_HEAVY_AI_INSTALL=1` is also set, install selected
  heavy models through the real UI. Never add model downloads to default test
  profiles.

- `npm run test:full`
  Runs the full matrix in dependency order. Heavy suites are included in the
  profile but skipped unless heavy mode is enabled. Use this for periodic broad
  confidence checks.

- `npm run test:full:continue`
  Runs the full matrix and keeps going after a failed suite. Use this when the
  goal is to discover as many failures as possible in one pass. Treat downstream
  failures carefully if an upstream build or prepare step failed.

- `npm run test:full:heavy`
  Runs the full matrix with `LIATIR_RUN_HEAVY_AI=1` and heavy suites enabled.
  This is for explicit heavy runtime checks, not normal development loops.

- `npm run test:full:heavy:install`
  Runs the full matrix with heavy AI installation enabled. This may download
  large runtime dependencies and model files. Use `LIATIR_HEAVY_AI_MODELS` to
  restrict the model IDs being installed.

- `npm run test:unit`
  Fast TypeScript contract/helper tests. Use this for pure registry contracts,
  parsers, path display helpers, and other deterministic logic.

- `npm run test:tauri`
  Full native E2E tests. This builds the frontend, compiles the Tauri bridge,
  builds the debug Tauri binary with the `wdio` feature, then runs the custom
  Tauri E2E harness against the real native webview.

- `npm run test:tauri:dev-smoke`
  Starts the real `npm run dev` flow with isolated test app storage, waits until
  the Tauri debug binary starts, then stops the process group. This catches
  config drift between normal development and the test-only WebDriver build.

- `npm run test:tauri:run`
  Runs the native E2E suite against an already-built
  platform-specific debug app. On macOS it prefers the app bundle; on Windows
  and Linux it drives the freshly compiled native executable. Use this after
  `npm run test:tauri:prepare` while iterating on tests.

- `npm run test:visual`
  Runs the visual smoke suite. The harness captures PNG screenshots from the
  native webview and compares them against baselines in
  `tests/e2e/__snapshots__`. Missing baselines fail unless the dedicated update
  command is used.

- `npm run test:quality`
  Runs unit tests, the normal `npm run dev` smoke check, native Tauri E2E tests,
  and the visual smoke suite. Use this before handing off larger UI/runtime
  changes.

## Test Matrix

The orchestrator lives in `tests/run-test-matrix.mjs`; suite definitions live in
`tests/test-matrix.mjs`.

The matrix exists so Liatir can scale from fast checks to expensive scientific
runtime tests without mixing their risk profiles:

- default profiles never download heavy models;
- heavy suites require `--include-heavy` plus `LIATIR_RUN_HEAVY_AI`;
- model installation requires the additional `LIATIR_HEAVY_AI_INSTALL=1`;
- every suite writes a dedicated log file;
- every run writes `tests/.artifacts/reports/latest.json` and
  `tests/.artifacts/reports/latest.md`;
- every run writes `tests/.artifacts/reports/latest-failures.json` and
  `tests/.artifacts/reports/latest-failures.md`;
- timestamped report copies are kept under the same reports directory.
- artifacts older than `LIATIR_TEST_ARTIFACT_TTL_DAYS` are pruned
  automatically from reports, screenshots, Tauri logs, visual diffs, and stale
  test app storage. The default is 7 days. Set a negative value to disable
  cleanup for debugging.

Useful commands:

```bash
npm run test:fast
npm run test:verify
npm run test:ui
npm run test:ui:visual
npm run test:visual:update
npm run test:full
npm run test:full:continue
LIATIR_RUN_HEAVY_AI=1 npm run test:heavy:ai
LIATIR_RUN_HEAVY_AI=1 npm run test:full:heavy
LIATIR_RUN_HEAVY_AI=1 LIATIR_HEAVY_AI_INSTALL=1 LIATIR_HEAVY_AI_MODELS=instadeep-nt-v2-50m-multi-species npm run test:heavy:ai
LIATIR_HEAVY_AI_MODELS=instadeep-nt-v2-50m-multi-species npm run test:full:heavy:install
```

Use `LIATIR_HEAVY_AI_MODELS` as a comma-separated list when a heavy test should
target specific model IDs. Keep defaults conservative, then expand targeted
runs as runtime boxes stabilize.

When a suite fails, first open `tests/.artifacts/reports/latest-failures.md`.
It summarizes the failed suite, command, log path, E2E report path, failing E2E
test names, and screenshots when available. The complete machine-readable data
lives in `tests/.artifacts/reports/latest-failures.json`.

## Native Harness

The E2E runner lives in `tests/e2e/run-tauri-e2e.mjs`.

It intentionally owns the native lifecycle:

- launches the compiled Tauri binary directly;
- prefers the binary inside the debug `.app` bundle so frontend assets and
  bundled resources resolve like the real app;
- sets a test-only app storage root;
- starts the embedded WebDriver server through the `wdio` Cargo feature;
- creates the WebDriver session with standard `fetch`;
- drives the native webview through a small fetch-based WebDriver client;
- captures failure screenshots and Tauri logs under `tests/.artifacts`;
- writes per-test JSON reports when `LIATIR_E2E_REPORT` or `--report` is set.

The custom session creation is deliberate. The upstream WebdriverIO runner
currently fails to create a session against the embedded Tauri WebDriver server
in this local Node/toolchain combination, while the same server works through
standard `fetch`.

## Isolation

E2E tests launch Liatir with a fresh per-run test-only `HOME`, `XDG_DATA_HOME`,
`XDG_CACHE_HOME`, and `XDG_CONFIG_HOME` under `tests/.artifacts/home`. This
prevents tests from reading or mutating the developer's real Liatir app data in
Application Support and prevents a recent test run from contaminating the next
one.

The dev smoke check uses the same isolation pattern under
`tests/.artifacts/home-dev-smoke`.

## Tooling Choice

Tauri on macOS uses WKWebView, which Playwright cannot reliably drive as a
native desktop webview. Native E2E tests therefore use the embedded Tauri
WebDriver server and a small WebDriver client implemented in the harness.

Playwright can still be added later for browser-only checks, but it must not be
used as the primary quality gate for features that depend on the native Tauri
bridge.

Use the native E2E harness for app behavior, state persistence, Jobs, Results,
AI Model installs, dependency resolution, and viewer capture. Use Playwright only
for browser-only surfaces such as public docs or isolated web components that do
not require the Tauri bridge.

`tests/e2e/specs/00-pipeline-lifecycle.e2e.mjs` is the baseline pipeline
lifecycle gate. It covers per-pipeline isolation across navigation, off-page
completion, deterministic failure, and interrupted-run reconciliation after a
webview reload, including exactly-once Results identity and native child Job
attribution. It also kills a real long-running child process and verifies the
distinct `killed` Job, `cancelled` Result, and unrelated-pipeline states. Its
typed minimap2-to-samtools fixture additionally verifies stdout-to-artifact
streaming, output-to-input transfer, and scientific Result provenance.

`tests/e2e/specs/execution-spine.e2e.mjs` is the common execution-spine gate.
Its five native cases cover independent logical Job settlement, standalone API
Connector success and cancellation, standalone Native Tool Job/Result identity,
WASM Plugin success/failure/progress/logs/off-page cancellation, and resumable
dependency download after cancellation through a real HTTP Range request.

`tests/e2e/specs/scientific-artifacts.e2e.mjs` is the focused Gate 4 native
test. It verifies streamed size, SHA-256 and HDF5 identity through the real
bridge, reloads persisted AnnData metadata, and proves that profile, validation,
digest and transformation lineage remain visible in Data and Results. Pure
compatibility, backward-version, mutation and Single-cell Embedding adoption
cases live in the `scientific-artifact-*` and
`single-cell-artifact-adoption` unit suites.

`tests/e2e/specs/single-cell-lighthouse.e2e.mjs` is the focused Gate 5 native
test. It opens a profiled AnnData Result with a bounded embedding preview,
verifies artifact identity, validation, projection and plotted points, adds both
outputs to Data, reopens them in the standalone viewer, and creates the saved
single-cell preset with typed output references. The
`single-cell-lighthouse` unit suite covers preview parsing, projection
precedence, compatibility rejection and preset wiring. It deliberately uses a
bounded local fixture and does not download or execute a heavy AI Model.

At Gate 5 closure on 2026-08-13, the focused Gate 5, artifact, pipeline
lifecycle and execution-spine suites passed after the main implementation. Two
later parser/PCA edge-case fixes pass their focused unit tests and
`test:verify`. The focused suite was subsequently rerun against the final Gate
6 Tauri binary and remained green 1/1.

`tests/e2e/specs/external-workflow-nextflow.e2e.mjs` is the focused Gate 6
native test. It requires system-installed Nextflow and Java and is skipped
unless `LIATIR_E2E_NEXTFLOW=1` is set. Its three cases use one saved definition
directly and twice in a pipeline, verify declared output handoff and engine
provenance, exercise a real process failure and owner-scoped cancellation, and
reconcile an interrupted External Workflow Result exactly once after reload.
The fixture is small and local; it does not download scientific data or a model.

Prepare and run it on macOS or a graphical Linux host with:

```bash
nextflow -version
java -version
npm run test:tauri:prepare
LIATIR_E2E_NEXTFLOW=1 node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/external-workflow-nextflow.e2e.mjs
```

`NXF_OFFLINE=true` may be added only when the selected Nextflow engine JAR is
already present in `NXF_HOME`. This is useful for a deterministic offline rerun,
but an empty offline cache is expected to fail before the product test.

Nextflow support on Windows uses the explicit native-app-to-WSL2 backend rather
than a native Windows runtime. Gate 6 keeps two distinct proofs. For native
Linux inside WSL2, keep the checkout in the Linux filesystem, compile a
separate Linux binary there, confirm it is x86_64 ELF, and run the suite under
Xvfb:

```bash
uname -m
nextflow -version
java -version
npm run test:tauri:prepare
file src-tauri/target/debug/liatir
LIATIR_E2E_NEXTFLOW=1 xvfb-run -a node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/external-workflow-nextflow.e2e.mjs
```

Record the E2E report plus `npm run test:verify`, `cargo test`, `cargo clippy
--tests`, `uname -m`, and `file` output. This remains Linux product evidence,
not evidence for the Windows app.

For the native Windows app, install Nextflow and Java inside an x86_64 WSL2
distribution, prepare a Windows binary, and run both the product suite and its
two-process restart companion from Windows PowerShell:

```powershell
wsl.exe --exec uname -m
wsl.exe --exec nextflow -version
wsl.exe --exec java -version
npm run test:tauri:prepare
$env:LIATIR_E2E_NEXTFLOW = '1'
node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/external-workflow-nextflow.e2e.mjs
npm run external-workflow:test:wsl-restart
```

The main suite starts from the real Windows UI. In addition to the common
direct, pipeline, output, failure, cancellation, and reload assertions, it
checks the reported WSL2 x86_64 runtime, the real `wsl.exe` provenance command,
mapped Linux paths, Job backend metadata, the per-run control lifecycle, and
that no token-owned process survives cancellation. The restart companion uses
two separate Tauri processes sharing isolated app data. The first persists a
real running Nextflow tree and its control identity; the second proves startup
cleanup kills that exact tree, preserves the original Job/Result parent, and
does not duplicate the interrupted Result after reload.

Gate 6 closed on 2026-08-14. The Windows app-to-WSL suite passed 3/3 and its
restart companion passed 2/2 phases. The independently compiled Linux x86_64
ELF app passed 3/3 under Xvfb. Both checkouts passed 51 files / 296 tests in
`npm run test:verify`, Rust tests, and `cargo clippy --tests`; exact platform
versions and limitations are recorded in
[Gate 6 Nextflow cross-platform evidence](../roadmap/gate-6-nextflow-cross-platform.md).

### Gate 7 desktop Beta lifecycle

Every supported desktop platform has two deliberately separate local gates: a
package gate that builds and inspects the format the product actually ships,
and a lifecycle gate that drives two native app processes against one isolated
test-owned home. Each orchestrator refuses to run off its own platform, and the
matrix skips the other platforms' suites instead of failing them.

```bash
# macOS arm64
npm run desktop-beta:package:macos
npm run test:tauri:prepare
npm run desktop-beta:test:macos

# Windows x86_64
npm run desktop-beta:package:windows
npm run test:tauri:prepare
npm run desktop-beta:test:windows

# Linux x86_64
npm run desktop-beta:package:linux
npm run test:tauri:prepare
npm run desktop-beta:test:linux
```

The macOS package gate creates an ad-hoc-signed app and DMG, disables updater
artifacts, verifies the signature and disk image, mounts the DMG and checks the
packaged executable. The Windows package gate builds the real NSIS installer,
requires the installer and both the packaged and installed executables to report
Authenticode `NotSigned`, then silently installs into a test-owned directory and
lets the generated uninstaller remove it again. The Linux package gate builds the
`.deb`, `.rpm` and AppImage, checks the ELF architecture, reads the Debian
package contents and version, checks the RPM and AppImage magic, and requires
that no updater signature was produced. None of the three is public release
evidence and none of their artifacts may be published.

The lifecycle gate proves one-time migration and restart recovery, then removes
the installed application and proves workspace state and Results remain. macOS
drives the build output because re-signing a debug WebDriver bundle changes how
macOS launches it; Windows and Linux drive the installed copy itself.

The Windows package gate needs a POSIX shell and `jq` on the Windows host: the
`*conf` scripts are shell scripts, and `npm run prodconf` now resolves the Git
for Windows shell explicitly through `scripts/run-conf.mjs`. It deliberately
does not fall back to `System32ash.exe`, which is the WSL launcher.

`tests/e2e/specs/app-update.e2e.mjs` covers the explicit update UI and verifies
that application restart is refused while a logical Job is running. A real
signed updater A-to-B test remains blocked on release signing inputs and must
not be replaced by weakening updater signatures.

Never reload the webview with a bare `browser.execute(() => window.location.reload())`.
The document is torn down before WebView2 acknowledges the command, so the call
never returns and the run sits on the harness's 600-second script timeout rather
than failing. Use `reloadLiatirApp` from `tests/e2e/support/liatir-app.mjs`: it
defers the reload by one turn and then confirms it against a new
`performance.timeOrigin`. The single-cell lighthouse hung exactly this way on its
first native Windows run.

For the complete macOS regression run, also execute:

```bash
node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/app-update.e2e.mjs tests/e2e/specs/single-cell-lighthouse.e2e.mjs
LIATIR_E2E_NEXTFLOW=1 node tests/e2e/run-tauri-e2e.mjs tests/e2e/specs/external-workflow-nextflow.e2e.mjs
```

On macOS these GUI tests may need to run outside a restricted shell sandbox so
WebKit and LaunchServices can expose the embedded WebDriver. A process that
stays alive while the WebDriver port never opens, with `hiservices` connection
errors in the Tauri log, is harness permission evidence rather than a Nextflow
failure.

The current evidence, unclaimed release checks and Windows/WSL continuation are
recorded in
[Gate 7 Beta 1 — macOS evidence](../roadmap/gate-7-beta1-macos.md).

`npm run pipeline:test:settlement-restart` is the process-restart companion.
The first Tauri process persists an active pipeline plus direct AI Model,
Plugin, Native Tool and API Connector executions. The second process reconciles
one interrupted Result for each owner, leaves downstream pipeline work pending,
and reloads once more to prove that no Result is duplicated.

The broad `npm run test:ui` baseline on native Windows x86_64, measured on
2026-08-19, is 19 passed / 17 failed / 19 skipped. Eleven failures are the
categories the Gate 3 closure already listed: stale AI catalog expectations, the
intentionally hidden Dependencies sidebar route, and Quenta reload/selection.
Six are not: three `00-pipeline-lifecycle` cases, the standalone FastQC Native
Tool Job, the Python `.lia` plugin `plugin-runtimes` path, and
`single-cell-lighthouse`.

That last one matters more than its count. It passes 1/1 when run on its own,
on both macOS and Windows, and fails inside the full suite. The whole suite
shares one isolated home for the entire run, so treat it as state contamination
between specs, not as a failure of the product path the focused Gate 5 gate
proves. Keep all six separate from common-spine regression triage until those
surfaces are realigned, and do not read "passes in isolation" as "passes in the
suite".

`tests/e2e/specs/dependencies.e2e.mjs` includes a heavy managed-binary gate.
With `--heavy`, it downloads the real checksummed SeqKit release into isolated
test storage, executes it through the same bare-name Jobs resolver used by
pipelines, and removes it. Direct managed support is intentionally limited to
the verified [Native Tool support matrix](../roadmap/native-tool-support.md).

## Writing New Tests

Add native E2E specs under `tests/e2e/specs`. A spec exports a `tests` array:

```js
export const tests = [
  {
    name: 'opens the sandbox workspace',
    async run({ browser, expect }) {
      // Use browser commands against the real Tauri webview.
    },
  },
];
```

Use native E2E tests for:

- dependency install/check/update flows;
- AI Model install/remove/run flows;
- pipeline execution and Jobs page behavior;
- viewer rendering, fullscreen, screenshot capture;
- real filesystem persistence and analysis-run finalization.
- page navigation while a process is running;
- per-entity disabled states, especially pipeline runs and AI Model jobs;
- visible error hygiene and path sanitization.

Use unit tests for:

- source-of-truth registry invariants;
- parsers and output adapters;
- path sanitization and display helpers;
- deterministic data transformations.

Do not install heavy models or large dependencies in the default smoke suite.
Put those in explicit, opt-in tests with clear names and timeouts.

Heavy AI tests should mark each test with `heavy: true`. If a test needs an
extra opt-in switch, set `requiredEnv` on the test object:

```js
export const tests = [
  {
    name: 'installs selected heavy AI Models',
    heavy: true,
    requiredEnv: ['LIATIR_HEAVY_AI_INSTALL'],
    async run({ browser, expect }) {
      // Install through the real UI.
    },
  },
];
```
