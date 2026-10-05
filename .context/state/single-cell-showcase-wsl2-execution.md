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
  Windows and Linux imports both passed all 185 exact file hashes; semantic
  matrix/split/embedding alignment remains a separate pending check.
- [x] Verify both matrices/splits and nine completed embeddings semantically,
  including shape, finite values, unique cells and exact split cell order.
  [Linux evidence](../../showcases/single-cell-foundation-benchmark/validation/imported-matrices-wsl2.json)
  confirms PBMC 11,990 × 3,346 and pancreas 16,382 × 19,093, all CSR counts
  finite/nonnegative, valid column bounds, exact split order and nine ordered
  finite embeddings. No inference or metric computation was repeated.
- [ ] Create a fresh pinned Linux checkout under the Linux home directory;
  recreate only the required pinned Linux environments and verify signed
  target availability through normal app activation. Never reuse Mac binaries.
- [ ] Repair scGPT atomic batch persistence, strict input/model/code/seed/
  environment/host identity and accounting across attempts. Exercise actual
  interruption/resume on a tiny fixture; observe changed-identity rejection
  and equal resumed/uninterrupted results. One focused repair cycle before
  reassessing; no full inference until this passes.
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
