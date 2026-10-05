# Single-cell showcase execution

Authoritative scope: [the requested study](./liatir_single_cell_showcase_codex_plan.md).
Started 2026-10-03; resumed 2026-10-04 after host/app interruption. **Suspended
2026-10-04 after the user reported that the work may be crashing the computer.**
No study processes remained when checked. The complete study remains open.
The bounded approved resumption below produced full PBMC measurements; the
earlier diagnostic samples are never presented as full-study results.
**Current status: stopped on 2026-10-05, transferring to Windows/WSL2 at the
user's request.** The historical "next" and "active" statements below describe
earlier transitions. Follow the [current handoff](./single-cell-showcase-wsl2-handoff.md)
before any further execution.

## Session interruption and transfer, 2026-10-05

- Full pancreas run `6071da5e-c592-4ee3-8544-7bbe5b12be8f` retained complete
  PCA, Geneformer, Harmony and scVI embeddings and final telemetry. It did not
  reach common evaluation, final figures or a six-row summary.
- scGPT's last saved progress was 10,752 / 16,382 cells (65.6%). Its code holds
  all intermediate batches in memory and writes only after the last cell.
  No partial embedding, final telemetry or provenance exists. The partial work
  is lost; do not treat its progress log as a reusable representation.
- At 09:45 UTC the foreground driver session no longer existed, the model
  worker and child were absent, and no task-owned native app, frontend or monitor
  remained. The monitor's last records around 09:44:38 UTC still say
  `monitoring`; these are stale interruption evidence, not completed measurements.
  The exact termination mechanism was not established. No fresh panic-report
  check was performed after this interruption.
- New defect: inference needs atomic disk checkpoints of completed batches,
  verified input/model/code/seed identity and honest accounting across attempts.
  The long native driver must survive interruption of the agent's foreground
  tool session. Add regression coverage for interruption/resume before another
  full scGPT attempt. Neither repair has been implemented. Retry limit: one
  focused implementation/validation cycle before reassessing a failing design;
  no repeated hours-long attempts to test durability.
- Existing completed-stage restore rejects any frozen code difference. The
  presentation-only reporting change already differs from the interrupted run;
  future checkpoint changes will differ too. Preserve scientific identity checks
  and explicitly validate reuse of unchanged completed stages. Do not disable
  this guard or edit historical provenance to make it pass.
- The user asked to push the work and supply a continuation prompt for Windows
  with WSL2. Only handoff preparation/validation and the requested Git push are
  in scope on this Mac now. Keep original Mac results and costs intact; any new
  Linux measurements require their own host/runtime identity.

## Authorized cautious resumption, 2026-10-04

The user approved the proposed CPU-only, one-cell model batches, resource limits,
small stability test and resumable artifacts. This supersedes the automatic-restart
stop above only for this bounded path; never repeat the previous Metal workload.

- [x] Identify and remove only the task-created obsolete Plugin environment
  `plugin-single-cell-fo-1-0-0-31435fb2d700` and rejected Figshare 41581626 derivative.
  Retain current pinned environment, canonical inputs, all results and crash evidence.
- [x] Add an independent lightweight process monitor, with explicit stop records:
  CPU only, one thread, model batch size one, maximum process RSS 2 GiB,
  minimum host available memory 2 GiB, minimum free disk 4 GiB, maximum swap growth
  256 MiB. Exercise a forced stop before running real inference. Limits apply to
  preparation, baselines, models and evaluation; checkpoint completed stages.
- [x] Run a tiny PBMC stability sample through the native app. It is a diagnostic,
  never a replacement for the complete datasets or a scientific result.
  Run `42d6ad23-07fd-4ba4-94f4-eba46068892c`: 72 cells, PCA and Geneformer completed,
  all metrics/figures/ZIP produced; native UI test passed. Geneformer CPU batch one:
  8.192523 seconds, peak worker RSS 584,843,264 bytes, monitor peak 597,917,696 bytes.
  Encoder-only hidden states matched the original masked-language-model path
  bit-for-bit. No guard stop. The subsequent all-method diagnostic
  `09caa041-af36-400d-959f-0de6be75683d` passed through the compiled production
  UI: PCA, Geneformer, Harmony, scVI and scGPT completed; UCE's checkpoint alone
  requires 3,403,469,828 bytes and was refused before allocation against the
  2 GiB cap. All score tables, UMAPs, cost figures and ZIP exist. Native chart and
  Result/export assertions passed. These remain diagnostic measurements.
- [ ] Proceed to full datasets only after the sample completes within the limits.
  Preserve guard stops as failures, inspect their cause before retrying. No remote
  compute is authorized or planned. Do not weaken limits to force a completion.

Pancreas preparation now reads the supplied count layer in sparse row blocks; validate
it against the source before the full run. Model resources remain signed and unchanged.
Required regression checks cover guard termination, checkpoint identity validation and
unchanged count values.

Latest resumption: the all-method diagnostic finished and no process survived.
No new panic report exists. The separated native compilation and packaging now
passed: compiler family peak 1,911,439,360 bytes, bundle peak 110,428,160 bytes,
no swap growth. The bundled executable matches the compiler output, SHA-256
`10ca77825884a8cdf6c861bc15b6dfc4eaa562ff575aea82ee8a6dad7308e0ea`.
Capability files match their original Git bytes. Validate native signal handling,
then run full PBMC followed by pancreas. Stop on a new host failure; never loosen limits.

The native signal regression passed (one test, zero failures). Full PBMC run
`7afd5cd1-2911-45c7-be7f-28cb212734ca` completed through the bundled native UI,
all six requested methods, stability sampling disabled. The 11,990-cell source
and PCA embedding are saved. Geneformer, Harmony and scVI subsequently completed
and saved their embeddings and final telemetry. scGPT subsequently completed all
11,990 cells and saved its embedding. UCE's exact checkpoint-storage preflight
refused allocation: 3,403,469,828 bytes against the approved 2,147,483,648-byte
limit. Its failed configuration, logs and telemetry are retained. The common
evaluation, all figures and export completed. The native full-PBMC Results/chart
assertions passed (one test, zero failures), bundled production UI. Actual complete
PBMC scores are now recorded; pancreas and independent reproduction remain open.

Next full run: `LIATIR_STUDY_MODEL_ROOT` points at the existing normal app's signed
AI runtime directory; execute `node scripts/run-single-cell-showcase.mjs pancreas
pca,geneformer,harmony,scvi,scgpt,uce`. No diagnostic sampling, same seed and resource
limits, only this study workload. Expected evidence: 16,382 source cells / 19,093
genes, a six-row summary, retained causes for any blocked methods, native Results
and export assertions. On any implementation failure inspect the exact logs before
a diagnosed retry (maximum two); no resource-limit relaxation or replacement input.

## Host stability stop

Two macOS full-system panic reports coincide with the two Geneformer attempts:
2026-10-03 21:11:59 +0200 and 2026-10-04 04:03:58 +0200. Both report
`watchdog timeout: no checkins from watchdogd in 94 seconds`. This establishes
system failure during the workloads, not a uniquely proven cause.
Both reports also explicitly say `LOW swap space` (8 and 7 swapfiles respectively).
This supports investigating memory/disk pressure; it does not establish a sole cause.
The earlier
interruption was incorrectly treated as an ordinary stopped session before retrying.
The second run is `e8a2f3a1-5ee2-4779-a4e6-9c6fa3931e09`; its PCA completed,
Geneformer saved only its start log, and no final model telemetry exists.

The read-only check after the user's warning found no study driver, native test app,
study Python process or task-owned caffeinate process. Disk had only 5.2 GiB free.
Evidence: [crash correlation and suspension](../../showcases/single-cell-foundation-benchmark/validation/host-crash-suspension.json).
Keep partial artifacts; do not classify the study as complete or claim scientific
model infeasibility from this alone. Before a future resumed calculation, resolve
host stability and a bounded execution strategy. No further build, model execution,
or full test suite was launched after the warning. Changes remain uncommitted;
latest report/source refinements have not passed the final gates.
The lightweight `syngraphe check` was run: it reports `LINK001` on the authoritative
plan's then-missing [report/results.md](../../showcases/single-cell-foundation-benchmark/report/results.md).
The transfer now includes a substantive interim report with actual PBMC scores;
it explicitly leaves the complete study unfinished.

## Checklist and evidence

- [x] Read repository policy, architecture, existing embedding runners, execution ownership,
  Results finalization and native test harness. Working tree initially contains only the
  user-provided, untracked authoritative plan.
- [x] Locate all three installed signed model boxes in the normal app profile. Host: Apple M1,
  16 GB memory, macOS 14.4.1; approximately 10 GB free at discovery. Verify activations through
  Liatir before use. Do not duplicate or modify their payloads.
- [x] Pin canonical datasets, raw-count source, identifiers, common filtering and fixed split.
- [x] Build the showcase using existing Python Plugin environment management, signed AI Model
  execution, workspace run identities, Jobs, Results and Plotly output sections. A benchmark
  run owns its own directory and child Jobs. Dependencies install only on explicit launch.
- [x] Produce PBMC PCA and Geneformer numerical results through the native app first.
- [ ] Execute all six methods on PBMC, then on scIB pancreas. Retain failures and logs; use
  null plus reason for missing measurements. Never replace a requested dataset or model.
- [ ] Export the complete manifest, summaries, figures, report and tested reproduction steps.
- [ ] Validate scientific calculations and cell alignment; run test:verify, test:ui and
  syngraphe check; review the final diff and record exact completed/blocked criteria.

## Execution constraints

Reproduction packaging check: the final combined export keeps each native run's
identity, frozen code and environment under its dataset directory. The metric
reproduction helper accepts that assembled layout as well as individual native
run directories. Test it against the final export, retaining its comparison JSON;
do not infer reproduction success from helper compilation or the original run.

Use the normal signed-model activation APIs. The baseline/evaluation dependencies need an
isolated Python Plugin environment because none of the published boxes contains all three
baselines and modifying a signed box would invalidate it. Reuse the existing environment
manager and process registry. Scientific computation is local; network is used only to fetch
declared public datasets and packages. No remote compute, publication, or GPU CI is planned.

Before each real run: record exact input identity, parameters, runner source, environment,
output directory and expected artifacts. Stop a run on non-finite data, identifier mismatch,
insufficient disk, or a failed process; retain diagnostics and continue independent methods.
Retry a diagnosed defect at most twice before recording it as blocked. Retain inputs and
embeddings outside Git with checksums; commit only small reproducibility artifacts and source.

## Diagnosed implementation defects

- Full pancreas attempt `60e49944-143e-43d4-a7b5-b0318d5713c4` prepared the exact
  16,382 × 19,093 source (prepared SHA-256
  `aeb6f9a2de14b881a81420018963d2d35e33d705f01ecc73c11a78f012001368`).
  PCA and Harmony stopped during dense scaling at process-family peaks
  2,213,134,336 and 2,198,536,192 bytes; scVI stopped at 2,473,689,088 bytes.
  The baseline path unnecessarily copies the full count matrix before gene
  selection, retaining raw counts even for PCA/Harmony. Remove that full copy;
  reread only selected raw columns for scVI. Regression: selected genes,
  normalized values, raw selected counts and PCA coordinates must exactly match
  the original preprocessing on a fixture. Check full pancreas preparation/count
  preservation before another complete run.
  Geneformer and scGPT both rejected the source's fractional counts using a local
  heuristic that infers normalization from noninteger values. The canonical source
  explicitly supplies this count layer, and both model transformations operate on
  nonnegative real values. Keep the default arbitrary-input rejection. Add an
  explicit canonical-source count attestation with source and prepared SHA-256,
  validated before accepting fractions; retain a warning and the exact fractions.
  Regression: absent/mismatched provenance rejects, exact recorded provenance
  accepts without changing values. No parameter or count changes. UCE's same
  preflight failed safely. With all embeddings absent, evaluation had no common
  set and the native Results test failed; retain the original attempt's artifacts.
  One diagnosed full native retry after these repairs and bounded validation;
  same CPU and resource caps, at most two diagnosed retries total.
  On 2026-10-05 the guarded pinned-environment suite passed all 11 tests,
  including exact original-versus-bounded normalized values, selected raw counts,
  selected gene identities and PCA coordinates. Canonical fractional-input
  provenance accepted without changing values; absent/wrong source or prepared
  hashes were observed rejecting. Unused model expression arrays and duplicate
  checkpoint references are released after their last use; inference math is
  unchanged. No study process survived the interruption and no new macOS panic
  report exists. Validate source counts, then bounded frontend/native rebuild and
  the diagnosed full pancreas retry. Do not run these expensive steps concurrently.
  The first updated `test:verify` stopped at one modularity assertion: the new
  shared count-validation fragment was missing from its directory's export barrel.
  Export it there and rerun the verification gate once; this is a bounded source
  integration correction, not a changed scientific configuration. The other 667
  unit tests passed. Both full datasets' source-count checks passed before retrying.
  The next gate passed unit, signer policy, generated SDK and core build, then
  Svelte rejected the new attestation because stage results were typed as unknown.
  Use the existing shared `JsonValue` type for the Plugin's serialized JSON result;
  no parallel contract. Rerun the gate after this exact type-boundary correction.
  Typing the entire stage dictionary as JSON also made existing report-result
  casts incompatible. Retain its original unknown result boundary and type only
  the new serialized attestation with the shared `JsonValue`. Check Svelte alone
  before rerunning the full gate; no native compile until this passes.
  The focused Svelte check passed. The complete guarded `test:verify` then passed
  all seven gates, report `2026-10-05T01-30-40-590Z`, 84 unit files / 668 tests,
  no Svelte errors or warnings. Process-family peak 1,857,093,632 bytes, no swap.
  The separated native compiler and packaging-only build now runs with the same
  known-good flags and an independent supervisor restoring test capabilities.
  That updated native compile stopped at 2,179,923,968 bytes after 18.6 seconds,
  with 4,976,476,160 host-available bytes and zero swap. Capabilities were restored.
  Inspection found a second 4,565,761-byte escaped Plotly copy for standalone HTML
  exports in addition to the chart asset. Read the same bundled asset on export
  demand and inline its identical bytes; preserve offline standalone behavior.
  Regression: chart-free reports do not load it, chart reports embed/escape it,
  missing assets visibly reject. Rebuild frontend and attempt the separated native
  compile once more, with unchanged optimizer flags and all resource limits.
  Three HTML-export regressions passed and guarded `test:verify` passed all gates
  after sharing the asset. Frontend output fell from 20,254,989 to 15,689,275 bytes.
  The second native compile nevertheless stopped at 2,173,321,216 bytes after
  31 seconds; capabilities were restored. Do not make another native-build attempt
  or raise its cap. The last successful binary, SHA-256
  `10ca77825884a8cdf6c861bc15b6dfc4eaa562ff575aea82ee8a6dad7308e0ea`,
  contains the current unchanged Rust bridge and its verified signal fix. Use its
  existing supported local-development origin to serve the corrected frontend;
  inference still runs in native Liatir Jobs, never as browser computation.
  Record this frontend mode honestly. Run one guarded local frontend at the exact
  authorized `http://localhost:5173` origin and the full pancreas driver with
  `LIATIR_STUDY_DEV_FRONTEND=1`; no other expensive workload in parallel. The
  updated production native packaging remains a documented host-budget limitation.
  The first local-frontend harness attempt failed before creating any study Job:
  it routed the old document while the cold server was still loading, then the new
  document replaced the study route with the dashboard. Use the existing deferred
  hard-navigation helper, which confirms document replacement and bridge readiness,
  before opening the workspace and study page. Retry UI startup only; no scientific
  configuration has executed or consumed a model retry.
  Corrected startup then launched full native pancreas run
  `6071da5e-c592-4ee3-8544-7bbe5b12be8f`, all six methods, no sample. Its prepared
  SHA-256 exactly matches the source-preservation-verified first attempt: no counts,
  cell IDs or gene order changed after the execution repairs. PCA completed and
  saved its embedding within the same resource cap. Geneformer follows. The local
  frontend is independently guarded; no additional scientific workload runs beside
  this study. Retain the packaging failures as engineering evidence, not scientific
  model failures or a claim of updated bundled-native validation.
  Visual review of PBMC figures found colliding PCA/Harmony labels in the runtime
  comparison. The final combined renderer uses a clearly labelled logarithmic
  runtime axis and separate method-label offsets. Only presentation changes;
  saved numeric scores and inference stay untouched. The active native run retains
  its original frozen Plugin code; combined figures are regenerated afterward.

- Stability run `15dd1605-633b-46f1-bd5e-717ce6b91d9a`: Harmony, scVI and
  scGPT produced embeddings. scGPT took 137.660431 seconds, OS peak RSS
  1,200,177,152 bytes. UCE was stopped after host available memory dropped below
  2 GiB; monitor peak process-tree RSS was 1,905,360,896 bytes and the final swap
  reading was 470,548,480 bytes above its initial value. No new macOS panic.
  The native model result reported success despite termination; collection then
  aborted on absent embedding output. Fix collection to honor the independent
  guard record, retain null measurements with reasons, and finish other methods.
  Regression: a claimed-success process with a guard-stop record must be blocked.
  UCE's pinned loader materializes the entire checkpoint; preflight its uncompressed
  tensor storage against the same 2 GiB cap before another attempt. Do not repeat
  the known unsafe allocation. One diagnostic retry after this repair.
  The underlying native defect is also localized: `jobs.rs` interpreted a missing
  exit code as success even when Tauri supplied a termination signal. Preserve
  its existing missing-code backend compatibility only when no signal exists.
  Add a Rust classification regression and a real native self-terminating-process
  regression. Rebuild with the successful bounded package override before the
  complete study; the public Jobs schema does not change.
- Production-build investigation: the prebuilt 4.3 MB Plotly runtime currently
  passes through CommonJS transformation despite already being browser-ready.
  Load the exact installed file as a local asset on chart demand, preserving
  offline execution and the existing security policy. Validate real chart rendering
  and one guarded production build; do not retry unchanged heap settings again.
  This change passed `test:verify` on 2026-10-04: all seven gates, 84 unit files /
  667 tests, no Svelte errors or warnings. The monitored process family peaked at
  1,917,206,528 bytes; swap did not grow. Report ID: `2026-10-04T14-45-37-326Z`.
  Native preparation will reuse the installed, verified Native Tools box and
  already validated dependencies, compile the bridge and update the test binary.
  Then run all applicable UI suites. Avoid repeating the default prepare step's
  unrelated full Native Tools rebuild and dependency reinstall on this host.
- Native rebuild: the monitored optimized Rust compile exceeded the aggregate
  2 GiB cap (2,229,796,864 bytes); host available memory remained 4,120,821,760
  bytes, swap unchanged. Temporary test permissions were restored after the stop.
  Retry only the app package at optimization level 1 with 256 code-generation
  units using a temporary Cargo package override; dependencies and scientific
  Python runtimes stay unchanged. Keep the same guard. At most one further retry
  at level 0 if needed, then report the compilation boundary. Remove the temporary
  Cargo configuration and confirm capability files match their original bytes.
  The level-1 / 256-unit build succeeded in 250.3 seconds, peak monitored RSS
  2,044,755,968 bytes, no swap growth. Both capability files match Git exactly;
  the temporary Cargo override was removed. The newly compiled native app embeds
  the new production UI, including locally loaded Plotly and the repaired study.
  After the termination-signal repair, three targeted Rust tests and Clippy passed,
  as did the updated frontend build. The final level-1 native compile was stopped
  at 2,189,541,376 aggregate RSS bytes, with swap unchanged. Restore its temporary
  permissions and use the already allowed final level-0 app-only retry. Keep all
  dependency optimization and the resource cap unchanged; no further unchanged
  build retry is allowed. Scientific Python code and runtime payloads are unaffected.
  The level-0 retry also stopped (2,163,818,496 aggregate bytes). Stop varying
  optimization levels. Distinct next approach: compile directly with Cargo, keeping
  the already tested level-1 / 256-unit app override and cached dependency settings;
  run Tauri's packaging-only `bundle` command afterward. This removes Node and
  Tauri CLI memory from the compiler's process family without changing any limit.
  A lightweight external supervisor restores temporary test capabilities even if
  the guarded compiler is terminated. Validate the new binary's signal handling
  and native study flow. One attempt for this separated approach.
  The initial direct command was deliberately interrupted before app compilation:
  inspection found it omitted `tauri/custom-protocol`, which the normal Tauri build
  supplies to embed the production UI. No guard breach occurred (peak 1,805,778,944
  bytes), and capabilities were restored. Correct this argument and use `--locked`
  before the single separated app-build attempt; never validate an app that depends
  on an absent development server as the bundled production UI.
- Cautious frontend build: the independent monitor stopped Vite at 2,198,880,256
  process-tree RSS bytes, while host available memory was 2,965,061,632 bytes and
  swap growth was about 47 MB. No study process remained afterward. Root cause:
  default Node heap growth exceeds the deliberately strict 2 GiB aggregate cap.
  Retry with Node heap capped at 768 MiB (then at most 1,024 MiB if necessary),
  keeping the same external resource limits. At most two retries; inspect logs
  after each failure. Do not raise the safety threshold to pass the build.
  Both capped-heap retries failed inside Node (768 MiB and 1,024 MiB), without a
  system crash; the external cap remained unchanged. Stop repeating that build.
  For native stability validation, use the already compiled unchanged Rust bridge
  and the existing explicitly authorized `http://localhost:5173` local-dev capability.
  This is the supported development UI inside the native app, not a browser-only
  scientific runner. Final production-build verification remains open.
- Guard regression tests: three passed, including observed termination of a 96 MiB
  dummy allocation at an 80 MiB limit and refused startup with insufficient disk.
  Two checkpoint tests passed, including observed rejection of changed code,
  counts and embedding hashes, and independence of mutable copied metadata.
  Core compilation and Svelte check passed (zero errors/warnings).

- Interrupted native pilot `44bf1a7d-f7c9-4dd2-9314-f72743c45c1a`: PBMC prepared
  (11,990 cells, 3,346 genes), PCA completed in 9.110909 seconds, process peak RSS
  1,346,420,736 bytes, embedding SHA-256
  `6b5c3febd28940c9152e73e927925fa0b9e187c0e16b13e169717e3f2cbde67d`.
  Geneformer Job spawned but no final artifact. No processes survived the interruption.
  Preserve pilot files in the isolated native test home; rerun after continuous model
  log capture is added. Do not count interruption as model infeasibility.
- Pancreas scverse URL returns HTTP 403. The scPoli tutorial's Figshare 41581626 is
  a 4,000-gene derivative, so reject it for the intended full-gene count source.
  Resolve the preceding scvi-tools tutorial source and validate raw counts before use.
  Resolved to Figshare 24539828 through the tutorial's preceding revision
  `c67d87491a6dd0fcc9429c2038b225507c5f3ed2`: exact expected 16,382 × 19,093,
  `celltype`, `tech`, `counts`. SHA-256
  `97e6dfd65553e4d10aa3ef5d904362970a75c677c31d70fabc9234191a09db8c`.
  Its source count layer has 23,809,035 fractional entries. Keep these unchanged;
  do not round or reconstruct. Report the count-model limitation explicitly.
- Scientific Python tests: three passed in the native Plugin environment (13.894 s).
  Includes alignment, fixed-split preservation, observed checksum rejection, nonfinite
  rejection and known-separable versus shuffled-label score sanity checks.

- First frontend build: raw imports climbed one directory above the repository. Corrected
  to the exact repository-relative path. Coverage: real frontend build; one retry required.
  The initial Svelte type check passed (zero errors/warnings), so type checking alone did
  not cover this asset-resolution boundary.
