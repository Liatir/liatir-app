# Single-cell showcase: Windows/WSL2 execution

Authoritative scope: [study plan](./liatir_single_cell_showcase_codex_plan.md).
Continue from [the verified Mac handoff](./single-cell-showcase-wsl2-handoff.md).
The study is open; historical Mac measurements must remain identifiable.
The persistence and import rules are recorded in
[their decision](../decisions/single-cell-checkpoints-and-historical-import.md).

## Checklist, 2026-10-05

- [x] Fetch the exact handoff branch and verify local HEAD and origin are
  `e0654c89be309783b473dd3ab6c677270559fde6`. Read repository policy, plan,
  handoff, execution record and showcase protocol.
- [x] Inspect the host: Intel i7-8700K, six exposed CPU cores, Windows RAM
  34,280,267,776 bytes. Ubuntu WSL2 exposes 25,201,582,080 RAM bytes,
  17,179,869,184 swap bytes (unused), approximately 852 GB available disk.
  Keep CPU-only execution, one numerical thread and batch size one; retain
  2 GiB process-family RSS, 2 GiB minimum available RAM, 4 GiB minimum disk
  and 256 MiB maximum swap growth. No paid compute or publication.
- [x] Verify the archive SHA-256 and all 185 files into a fresh showcase
  transfer directory. Preserve original roots, code, measurements and run identities.
  Windows and Linux imports both passed all 185 exact file hashes; the separate
  semantic matrix/split/embedding alignment check also passed below.
- [x] Verify both matrices/splits and nine completed embeddings semantically,
  including shape, finite values, unique cells and exact split cell order.
  [Linux evidence](../../showcases/single-cell-foundation-benchmark/validation/imported-matrices-wsl2.json)
  confirms PBMC 11,990 × 3,346 and pancreas 16,382 × 19,093, all CSR counts
  finite/nonnegative, valid column bounds, exact split order and nine ordered
  finite embeddings. No inference or metric computation was repeated.
- [ ] Create a fresh pinned Linux checkout under the Linux home directory;
  recreate only the required pinned Linux environments and verify signed
  target availability through normal app activation. Never reuse Mac binaries.
- [x] Repair scGPT atomic batch persistence, strict input/model/code/seed/
  environment/host identity and accounting across attempts. Exercise actual
  interruption/resume on a tiny fixture; observe changed-identity rejection
  and equal resumed/uninterrupted results. Real signed-model evidence below
  confirms exact 16-cell equality after abrupt native Job termination.
- [x] Detach the native driver from the chat process. Verify a launcher exit
  leaves its child alive, with durable per-execution identity, logs and exit
  record. No hidden scientific rerun during the durability test. Actual WSL
  foreground exit left fixture `f1dc08ff-4d3c-4215-8fd6-03edc4e661f3` alive;
  its supervisor subsequently recorded successful exit and the expected log.
  Three checkpoint regressions passed, including abrupt worker death, exact
  restored fixture values, seven rejected identity changes, corrupt batches,
  cell-order rejection and refusal of a second concurrent writer. The real
  signed-model interruption test is still required before full inference.
- [ ] Add explicit import/resume through Liatir with fresh run/Job identity.
  Check completed-stage dependencies independently of presentation changes;
  never disable identity validation or fabricate historical Jobs.
- [ ] Complete pancreas scGPT once under the unchanged guard. Preserve the
  lost Mac attempt separately. Diagnose UCE support/budget without repeating
  the known oversized allocation. Finish native evaluation/Results/export.
- [ ] Assemble twelve rows; reproduce metrics, verify source counts and all
  artifacts, inspect figures, update reports with actual Mac/Linux costs.
- [ ] Run test:verify, relevant native UI suites and syngraphe check; review
  diff, record evidence and commits. Archive the plan only when complete.

## Stop and cleanup rules

Refuse changed hashes, invalid alignment, nonfinite values, resource breaches
or unsupported signed targets. Diagnose a defect before a retry (at most two).
Keep failures and partial checkpoints; never overwrite the immutable transfer.
Temporary test inputs may be removed only inside their verified task directory.
No long computations may run concurrently with another expensive workload.

## Diagnosed preparation boundary

The pre-existing Windows Native Tools resources are older than this checkout's
tracked metadata. `native-tools:require` rejected their source revision before
native compilation. Do not weaken the packaging check. Read back workflow
`native-tools-box.yml` and completed run `36422000331` (revision
`1da8ad4d773c1624a976e03ff27f4b833e61b0d0`, success, 2026-09-28); the existing
Linux artifact is ID `10969653323`, 237,310,661 bytes, unexpired. Retrieve that
already-built artifact into transfer and verify its signature, target, source
revision and dependency lock with the existing gate. No workflow is launched.
One retrieval and one verification, then reassess any mismatch.

The artifact passed `native-tools:require`, including signature, Linux CPU
target, source revision and dependency lock. A fresh Linux checkout at the
exact handoff revision exists in `/home/lorenzo/liatir-single-cell-wsl2-2026-10-05`.

## Native compilation diagnosis and bounded retry

The first guarded Linux build stopped during the final application crate:
2,411,749,376 bytes process-family RSS exceeded 2,147,483,648. Swap growth
was zero and available RAM exceeded 22 GB. Dependencies compiled; the
application depfile was emitted 16 seconds before the stop, and application
warnings were logged. The record does not identify the exact compiler
subphase, so do not claim a linker diagnosis. Evidence is retained in the
Linux transfer build log and `validation/wsl2-native-build-monitor`.

One targeted retry: keep cached dependencies at optimization level two,
compile only the application at level zero (previously one), disable debug
information and incremental compilation, retain 256 code generation units
and one Cargo job. Use the same guard; capture per-process resident memory
to explain any second failure. Temporarily enable the existing WebDriver
capabilities, restore their exact bytes and remove the temporary Cargo
configuration in an external supervisor's `finally` block. This is a real
native development binary using the authorized local frontend; it is not
release packaging. A second memory refusal stops build retries pending a
specific new diagnosis; never increase the approved resource limits.

The retry was refused after 27 seconds: aggregate RSS 2,150,260,736 bytes,
with rustc 1,935,224,832 bytes, Cargo 180,510,720 bytes and two watchdog/
worker Python processes totaling 30,384,128 bytes. No swap growth. Exact
capability bytes were restored. Existing GitHub desktop artifacts predate
the handoff's `jobs.rs` termination-signal failure classification; CI stores no matching
native binary, so neither can stand in for this revision.

Specific next diagnosis: Cargo's measured 180 MB overhead is unrelated to
the compiler's work. Capture its exact rustc command without executing the
application compiler, then attempt that same command directly under the
same guard once. Preserve build environment variables required by Rust's
compile-time macros, without saving credentials. No compiler flags, app
functions, limits or scientific settings change. If the compiler itself
exceeds the remaining budget, stop this approach and retain the evidence.
Run the full verify gate sequentially first, with one Vitest worker and a
bounded Node heap; native compilation and numerical work remain separate.

The first verify invocation failed only because the new checkout lacked
`packages/liatir-cli/node_modules/jszip`: two plugin test modules and the
execution-spine spec loader could not import it. 656 tests passed, including
both new TypeScript regressions; peak process-family RSS was 776,450,048.
Install the already-locked CLI/API package dependencies as CI does, without
changing lockfiles, then repeat the complete gate once. This is environment
preparation, not a dependency upgrade.

The prepared complete verify gate passed all seven suites (82 seconds),
peak aggregate RSS 1,765,474,304 bytes, zero swap growth. Evidence:
[machine report](../../showcases/single-cell-foundation-benchmark/validation/test-verify-wsl2.json).
Current focused Python checks passed all three scGPT checkpoint tests and
both transfer tests. Broad Python discovery in the deliberately minimal
NumPy-only fixture environment cannot load `test_study.py` because pandas
is absent; run that scientific suite in the full pinned Plugin environment.

The direct invocation exited during checking, before code generation, because
the capture omitted twelve uses of `MAIN_WINDOW_*` compile-time variables.
Peak RSS was 1,188,896,768 bytes; this is not a native build success or a new
memory measurement of the full compilation. Read the existing build script's
exact `cargo:rustc-env` output, restore those declared non-secret window
settings into the captured environment, then execute the same direct command
once. The original direct attempt and all earlier failures stay retained.

The corrected direct compiler also exceeded the unchanged guard:
2,179,862,528 bytes aggregate RSS; rustc alone 2,145,951,744 bytes, zero
swap growth. All native build approaches are now stopped. A user question
is pending for an explicit 4 GiB ceiling for app compilation alone; all
scientific computations must remain at the original 2 GiB and all other
approved limits. Do not start a dependent native build without that answer.
Meanwhile finish independent transfer/source checks and retain all evidence.

Canonical download preparation exposed scVI's recorded local rename:
`pbmc/gene_info_pbmc.csv` comes from the recorded upstream `gene_info.csv`.
The finishing helper initially failed before downloading anything because
it matched the local basename literally. Preserve the exact manifest URL,
handle that single documented rename and require a unique recorded URL;
size and checksum verification remains mandatory. One download retry after
this correction; never substitute a different dataset or change the hashes.

The unchanged official 10x URL refused urllib's default client identity with
HTTP 403 / Cloudflare 1010. A bounded range request using the declared Liatir
User-Agent succeeded (206, recorded total 18,423,814 bytes, gzip signature).
Use that honest application identifier for source verification downloads;
no mirror or different input is needed. Preserve the original URL, exact
size and SHA-256 as the acceptance criteria.

All six canonical source/reference files subsequently passed the recorded
checksums and five recorded source sizes. PBMC 4k/8k archives, original
annotations, Figshare pancreas and GENCODE v47 are cached under ignored
Linux transfer storage. This verifies downloaded identities; exact original
count comparisons still require the pinned scientific environment.

After the final source-download and workspace-parent refinements, the complete
verify gate passed again: seven suites, 675 unit tests in 87 files, Svelte zero
errors/warnings, 81 seconds, aggregate RSS 1,746,247,680 bytes and zero swap
growth. The expanded current product scGPT Python also passed syntax checking.
`syngraphe.cmd check` passed on Windows (the PowerShell shim is blocked by the
host's script execution policy; using the ordinary command shim changes no policy).
No full model inference, final pancreas evaluation or native UI success is claimed.

## Persisted implementation checkpoint

Commit `0a0cd9267f8c8aada99eb36903fe8d01e316d4c3` contains the repairs,
import path, regression tests and retained validation records, directly on top
of the requested `e0654c8`. It is local; no push, release or paid action occurred.
The user's unrelated root `.gitignore` change and original untracked archive
remain untouched. The Linux checkout remains at the original handoff HEAD
with synchronized source changes and ignored transfer/build data.

Do not launch its current `src-tauri/target/debug/liatir`: that file is an older
cached executable, not a successful build of this revision. Accept a native
binary only after an actual successful guarded compiler exit and recorded
binary/bridge hashes. The required real 16-cell signed-model durability spec
is `tests/e2e/specs/heavy.single-cell-durability.e2e.mjs`; use the persistent
`tests/.artifacts/home/single-cell-showcase` test profile so its normal model
activation can subsequently serve the imported study. No full inference may
start before that spec passes. The 4 GiB compilation-only question remains
pending; elapsed waiting does not authorize a changed limit.

## Approved compilation exception — 2026-10-05

The user explicitly approved the requested 4 GiB ceiling for application
compilation alone: "Si certo autorizzo, su questo pc hai molto piu hardware
che sul mac credo". The scientific process-family ceiling remains 2 GiB;
CPU-only execution, one numerical thread, batch size one, seed 23, minimum
available memory/disk and maximum swap growth are unchanged. The PC has
34,280,267,776 bytes of host RAM, compared with the Mac's 16 GiB.

Next: execute the already captured corrected rustc command once under the
4,294,967,296-byte compilation guard. Restore temporary WebDriver capability
bytes regardless of outcome. Accept only an actual successful compiler exit
and newly recorded binary/bridge hashes. Then run the real signed-model
interruption/resume diagnostic before full pancreas inference.

The approved direct compilation succeeded in 29 seconds. Peak monitored
process-family RSS was 2,333,007,872 bytes, with zero swap growth. All temporary
capability bytes were restored. The newly compiled binary SHA-256 is
`e2b164637da607377c25a29aef62aecf42725f2ffa5bb46c4b039703868e4ccb`;
the current bridge SHA-256 is
`4b520fd7e2fbf8c42ab0e2f8fe7bd134be48f1cd3eac46be6261a5d8a52f9cf9`.
Evidence: [native build](../../showcases/single-cell-foundation-benchmark/validation/wsl2-native-build.json).
This is the current native development binary with authorized localhost UI
and existing WebDriver support, not a release package.

The first real diagnostic installed and activated scGPT Linux CPU
`0.2.5-beta.2` through the normal native API, then failed before inference:
the new spec passed an unsupported second message argument to Jest's `expect`.
This is a test defect, not a model failure. Retain its native report, replace
the four assertions with supported object assertions that expose stderr on
failure, and rerun the same 16-cell diagnostic once. No full inference starts
until exact resumed/reference values and changed-seed rejection pass.

The corrected diagnostic timed out before its first SQLite batch (180 seconds).
The monitored model process used about 342 MB and one full CPU thread, with no
swap growth; only startup stdout was present. This is an unresolved startup
boundary, not a checkpoint or scientific success. Native cleanup terminated
the fixture worker. Retain attempt 2. Before another full spec attempt, run a
guarded import-only probe with a timed Python stack dump in this exact activated
box to identify the occupied import/function. No model inference, box mutation
or resource-limit change is authorized by this diagnosis. Reassess from that
stack before retrying the same native diagnostic.

The import-only probe passed Torch startup in 1.1 seconds. The exact 16-cell
runner probe's timed traceback identified the real delay: the pinned
`GeneVocab.from_dict` calls `BuiltinVocab.insert_token` for every vocabulary
entry, rebuilding the entire index each time. The stack was inside that
dictionary reconstruction; no embedding had begun.

Use the pinned public `BuiltinVocab`/`GeneVocab` constructors once in the
recorded integer-index order and verify the complete token-to-ID dictionary
against the original JSON. Reject nonconsecutive or noninteger IDs. Do not
modify the signed box or model weights. The real diagnostic compares all
resumed output values with the unchanged frozen runner, including overlength
gene sampling; allow that reference alone 1,200 seconds for its known loader.
Keep the current first-batch deadline and all resource/scientific settings.
One diagnostic retry after this specific diagnosis. Mac timings include its
original loader; the new runner SHA and host distinction must stay visible.

The real signed-model diagnostic passed. Job `job_1` was killed after one
committed cell; seed 24 was refused, seed 23 resumed and completed all 16 cells.
All 512-dimensional values and cell identities matched the unchanged frozen
Mac runner exactly on the same signed Linux CPU runtime. Value SHA-256:
`ff3e2d9a0b2acd8fa3bea7be1dfa2b44ea1db68d3376dbdd1bc0a5c1ed3e965b`.
The checkpoint recorded interrupted/completed attempts; peak worker RSS was
744,640,512 bytes. Evidence:
[signed-model durability](../../showcases/single-cell-foundation-benchmark/validation/scgpt-durability-wsl2.json).

Next native imports: PBMC source `7afd5cd1-2911-45c7-be7f-28cb212734ca`
reuses all five successful methods and its finalized UCE refusal, without
repeating evaluation. Pancreas source `6071da5e-c592-4ee3-8544-7bbe5b12be8f`
reuses four methods and runs only scGPT, then the shared evaluation/report.
Use the existing driver with `--detach`, the normally activated CPU runtime,
the unchanged scientific guard and fresh native parent/child Job identities.
Inspect any failure before a bounded retry; preserve the immutable originals.

A direct Xvfb automatic-display probe failed because WSLg's shared socket
directory could not provide its filesystem listener; no study was launched.
Keep its diagnostic log and use the already proven `xvfb-run -a` path instead.
The same detached Node supervisor used by `--detach` now owns the display
wrapper and native PBMC driver. Its request records the selected source,
activated-model root and task settings; no global display permission changes.

PBMC import attempt `5d662ebc-7e81-4a96-a738-1dc9facdd63c` failed before
launching a study: the Linux overlay still had the handoff's old benchmark
page, so the new import control was absent. No scientific stage ran. Audit
and synchronize every tracked implementation/context change against e0654c8,
excluding the user's unrelated root gitignore and generated validation data;
verify source hashes and rerun the complete verify gate on that overlay.
The unchanged Rust bridge remains the newly compiled handoff binary. One
native import retry after this source-alignment correction.

The complete synchronized-source verify gate passed all seven suites in
84 seconds, peak process-family RSS 1,749,975,040 bytes and zero swap growth.
The first invocation used an unsupported report option and exited before any
suite; the declared `--report-dir` invocation passed. The reviewed page also
clears its original import selection when resuming its new workspace run,
preventing mutually exclusive import/resume inputs from being sent together.
Current PBMC execution is detached instance
`77c270da-550e-4272-8f68-d827e99fe39e`; no historical inference is requested.

Native PBMC import `11b0a26c-3ac5-44da-93e8-491b946eeb0a` passed its UI,
Results and export checks. Its only new Jobs are prepare/report, both done;
all original scores, costs and embedding hashes matched exactly, including
the retained UCE refusal. The pinned study Plugin environment activated normally.

New driver defect: the native E2E child finished, but the outer driver's
recursive watcher of the entire app profile occupied one CPU thread and left
that child unreaped. This profile now includes both complete Python/runtime
trees. Retain the successful native evidence separately from the driver's
failed finalization. Inspect the occupied Node stack and terminate only the
verified task-owned log driver after confirming no science remains active.
Restrict watching to task workspace run outputs, and print only live guarded
model progress, excluding historical imports. Verify a clean actual driver
exit with another import-only PBMC UI check (copy/report; no inference or
evaluation) before any full pancreas work. One retry after this correction.

The Node stack confirmed recursive `#watchFolder`/path normalization occupied
the log driver. Only that verified driver was terminated; its supervisor
truthfully recorded exit 143. The corrected observer watches workspace run
outputs and ignores completed/historical model progress.

The follow-up import-only native check passed and its detached driver exited
naturally with code 0: execution `d4e02d95-8f5c-4fdf-a5ba-1587b970f46d`,
PBMC parent `c8dcfc55-cb26-4074-a877-5ec423b62817`. Only prepare/report Jobs
ran; completed inference and evaluation were reused. Results/charts/export
passed with the original UCE refusal displayed, not concealed. Use this fresh
PBMC export for the final assembly. The original earlier successful import
and its driver failure remain retained as separate evidence.

Full native pancreas continuation is now detached execution
`0a11a75b-cce3-4897-88c6-2e027a6d3fad`, parent
`2eb280d5-6af6-46da-a78b-be3278fdbc65`. Its verified source is the original
Mac pancreas export; four completed representations are reused. Only scGPT
inference is new. Native evaluation/report follow in the same app lifetime.
Do not edit frontend/raw study sources or run expensive checks during this
execution; a development reload could lose its in-flight orchestration.

An independent detached finisher waits on that exact driver's real exit file.
It refuses failed execution, mismatched parent/scope or any non-UCE incomplete
method. On success it uses the actual native Plugin Python from the PBMC
activation to run finish_study.py on these two exports, a fresh
`transfer/completed-study-wsl2-2026-10-05` directory and the verified public
cache, then the full scientific unittest suite under the unchanged 2 GiB guard.
Inputs and exact commands are recorded in `transfer/final-study-inputs.json`
and the finishing execution request. No inference/training is repeated by the
finisher. Its existence is not completion evidence. Broader native UI checks,
visual review, curated artifact copying and final context closure remain.

The full scGPT worker has real committed batches and a live independent guard:
143 cells at the first semantic checkpoint inspection, peak process-family RSS
1,607,135,232 bytes, below the unchanged 2 GiB cap. The Mac's four embeddings
have been restored without new inference. The finisher's first generated
launcher had a newline-escaping syntax error and exited before waiting or
running any calculation. Preserve that failed execution, repair the local
launcher, pass `node --check`, and relaunch only the waiting finisher. The native
scientific execution is unaffected and must not be restarted.

Measured early throughput is about 24 cells/minute (500 committed cells,
1,265 seconds recorded attempt time, one CPU thread at 99.4%). More RAM does
not establish faster execution under this frozen single-thread protocol.
Keep the approved settings and 24-hour native job deadline; do not restart
or change the running model merely to improve speed.

Before it began calculations, the waiting finisher was replaced with an
expanded, syntax-checked continuation. After scientific validation it also
runs the complete seven-suite verify profile and the relevant native UI
matrix: tauri-e2e, single-cell-index-e2e, pipeline-settlement-restart-e2e.
The already verified current native binary serves those suites; unrelated
desktop packaging/release gates are outside this study. These checks run
sequentially, under 2 GiB guards, only after native pancreas completion.
No source/frontend rebuild occurs during the live study. Final visual review,
curated copying and context closure still require actual successful evidence.

Manual visual inspection of the successful imported PBMC native Results screenshot
and four figures passed: the actual UCE refusal and exports are visible, both cost
plots retain readable Mac labels, and PCA cell-type/batch maps have readable axes
and legends outside the points. `validation/visual-review-pbmc-wsl2.json` records
their hashes and this limited scope. Final assembled and pancreas visual review
remain pending; no final-study completion is inferred from the PBMC inspection.

The first full PC attempt stopped at 1,181 committed scGPT cells. Its independent
guard correctly refused 281,591,808 bytes of host swap growth above the unchanged
268,435,456-byte ceiling, despite 22,865,940,480 bytes available and peak RSS
1,609,723,904 bytes. Both the native driver and dependent finisher failed; retain
their actual exits, the complete saved database and the generated four-method
evaluation separately. The mechanism initiating guest swapping is not yet proven.
Do not relax the guard or recalculate these committed batches.

A second durability boundary is now observed: after the foreground completion
observer exited, the WSL distribution shut down and restarted on later commands.
Orphaned Linux processes alone do not provide a Windows-owned WSL session.
[Microsoft documents this distinction](https://learn.microsoft.com/en-us/windows/wsl/systemd).
Before a long retry, add a Windows background supervisor holding a foreground WSL
command until the entire pipeline exits. Verify survival beyond the WSL idle
shutdown interval without other WSL commands. Place only that execution's process
tree in a unique systemd unit with MemorySwapMax=0; confirm its actual cgroup
identity and setting. This strengthens the swap constraint without raising any
scientific limit or changing the global WSL configuration. Retain host-wide swap,
RSS, available-memory and disk guards unchanged. One bounded native retry after
these checks, importing the finalized failed PC run to resume its 1,181 cells.

The Windows-owned session check passed in a real unique systemd unit: 95 seconds
after its launching PowerShell/Node processes had exited, without intervening
WSL commands, the fixture retained the same boot identity and zero swap. Its
Windows supervisor then recorded actual exit 0. Both cross-platform background
driver tests passed, including a configured external command's real exit 9.
The full continuation is Windows execution `60e824c9-e828-43e8-8bbd-3fe665d04f4d`,
unit `liatir-single-cell-d85b16d1-814a-45cd-b2a7-b3d724463993`. Readback confirmed
that exact cgroup, MemorySwapMax=0 and source PC parent 2eb280d5. It first runs
the seven-gate verify profile under 2 GiB; only success launches the resumed
native study and its dependent finisher in that same persistent WSL session.
No global swap, reclaim, RAM or WSL idle configuration was changed.

That prerequisite verify gate passed all seven suites (87 unit files, 676 tests)
before any new science, peak process-family RSS 1,811,415,040 bytes, zero swap.
The corrected native parent is `22c037dc-6d1b-4b3a-9234-5246b8258f25`, Linux
execution `15ddb224-6bee-4a50-8f9e-350f2f113c77`; its waiting finisher is
`e4a013e1-5908-4c02-b48e-67d99a3da6a1`. The runner reported reusing 1,181
committed cells. Independent readback matched every prior batch boundary/hash,
with the old attempt marked interrupted and a new running attempt. At 1,255
saved cells, process-family peak RSS was 1,614,045,184 bytes; both cgroup and
host swap were zero. This is progress and correct reuse, not final completion.

Final curation must also carry the full source lineage: this ordinary PC resume
retains its prior PC parent's frozen-code path and original Mac environment.
Preserve the prior PC export's verified imported-source/import-origin attachments
and parent records in the assembled bundle, checking their bytes against the
original transfer manifest, without rewriting any method's scientific records.
Keep unknown scGPT runtime null with its verified lower bound and reason; explain
its omission from any plot requiring an exact runtime. Do not invent a duration.

## Explicit PC resource amendment, 2026-10-05

The user clarified that local limits may increase and the otherwise idle PC
should be used fully with a crash-prevention margin. Follow the
[recorded decision](../decisions/2026-10-05-single-cell-pc-resources.md), which
supersedes the previous unchanged-resource restriction for new PC stages.
They subsequently accepted retaining the virtual native app window. Every
representation still runs through Liatir's signed runtime and Jobs APIs.

- [x] Measured six available i7-8700K cores, 31.93 GiB host RAM, 24 GiB WSL
  ceiling and RTX 4060 Ti / 8,188 MiB; current driver 610.62. No global WSL
  settings changed. The catalog contains signed scGPT CUDA 12.9 beta.2.
- [x] Cancelled active CPU parent 22c037dc through the native execution store.
  Native driver and dependent finisher recorded actual exit 1, as expected after
  cancellation. Preserve these outcomes; they are not model infeasibility.
- [x] Copied the released CPU checkpoint: 2,066 cells, database SHA-256
  `a3a13dc015e070d7ecea088945642250597b05cbc557e95334c3ad79f4c9277e`.
  Original run and all Mac results remain intact. Never merge this CPU database
  into an incompatible CUDA identity.
- [ ] Native signed CUDA installation: Windows execution
  `c018c3b1-3a32-423b-aefe-e6df96ad63d0`, unique unit
  `liatir-scgpt-cuda-install-c6966204-9663-4db5-a30f-2dd73ef5ad54`,
  MemorySwapMax=0 / MemoryMax=16 GiB. Verify exact activation revision/target,
  model hashes, CUDA capability and actual exit before using it.
- [ ] Validate the explicit PC profile and whole-GPU watchdog. Exercise an
  observed GPU limit refusal/stop, real-data batch behavior, kill/resume equality
  and changed-identity rejection on a bounded fixture through native Liatir.
  Select batch size using throughput and measured memory; no score-based tuning.
- [ ] Run the updated seven-suite gate and full scientific regressions. Ensure
  historical imports accept different new limits while unchanged normal resumes
  still reject them. The common/evaluation definitions remain byte-identical.
- [ ] Restart only unfinished pancreas scGPT using the verified historical Mac
  export and new PC resources, reusing its four completed methods. Keep the
  Windows-owned foreground WSL session, no-swap cgroup and independent guards.
- [ ] Complete all original evaluation, native Results/export, assembly,
  reproduction, source counts, relevant native UI checks, visual review and
  curation. Preserve Mac / PC resources and earlier failed/interrupted costs.

Stop on incompatible signed target, failed diagnostic or guard breach; retain
actual logs and partial saves. Diagnose before one bounded corrected retry.
No paid jobs, GPU CI, new target publishing or release is authorized.

PC preparation evidence: the signed CUDA target activated through the native
installer, exact catalog archive `3da31f6e…`; its native gate passed and the
Windows supervisor recorded actual exit 0. The updated repository gate passed
87 files / 676 tests, all seven suites, followed by the pinned scientific tests.
Native CUDA diagnostics passed on the exact first 128 original pancreas cells:
intentional interruption after 16 committed cells, changed-seed rejection and
exact resumed/uninterrupted GPU equality. The maximum CPU/GPU absolute
difference was 2.682209014892578e-7, minimum cosine 0.9999997615814209; these
are compatibility diagnostics, not a reason to merge the different checkpoints.

The final diagnostic observed the GPU guard refusing a deliberately impossible
one-byte GPU budget. Batch 16 processed 128 cells in 4.201826709 seconds for
tokenization/encoding/copy/commits, process-family peak 1,159,299,072 bytes,
whole-GPU peak 4,777,312,256 bytes, no workload swap. Batch 32 was stopped by
PyTorch's independent 5.5 GiB allocator ceiling before completing a batch;
retain this diagnosed allocation failure and select 16 for the full run. No
system crash occurred. Windows diagnostic execution
`9097732b-28da-471f-abb3-4ca12acb67d3` recorded actual exit 0.

Observed dev-only defect: after browser-API generation, Vite attempted sibling
output-parser JavaScript files outside its default frontend-only serving list.
Allow this actual repository workspace explicitly; do not weaken the native
origin capability. Regression evidence must include direct sibling-module
availability and the native full-study/Results flow. One bounded recheck before
the accelerated full run. No change to inference mathematics or frozen common
evaluation definitions is required.

The corrected seven-gate recheck passed, report
`2026-10-05T16-30-51-766Z`, followed by scientific regressions and a successful
shared sibling-module HTTP check. The full GPU parent is
`12b601e2-cd4f-44ba-b3ec-1238b7da569f`; Windows execution
`9d50a8e0-464d-4bc9-a49d-01c15b087234` owns unit
`liatir-single-cell-69374c90-5851-4f14-b986-caf41d197735` and its dependent
finisher `b0b53790-de71-4860-8778-f915bea04801`. Readback confirmed the exact
CUDA 12.9 / RTX target, six threads, batch 16, 16 GiB RAM / 6 GiB GPU guards
and cgroup MemorySwapMax=0. The executed scGPT runner SHA-256 equals current
source: `35544712015f03c57b9a9d7f42f57932a79623a8f992b4eafe775496e2a2f2b1`.
The new run imports the verified original Mac 6071da5e export directly; the
old Windows input cache is orchestration history, not its scientific source.
All four reused embeddings, telemetry and configurations match the Mac bytes.
The preserved 2,066-cell CPU checkpoint and cancellation record are attached
under historical-attempts, without merging vectors or altering measurements.
This records a verified running study, not final completion.
