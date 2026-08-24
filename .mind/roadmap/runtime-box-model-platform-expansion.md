# Runtime Box model platform expansion

Last reviewed: 2026-07-27

Status: **historical pre-pixi execution ledger — do not dispatch from this
document.** Its completed evidence remains valid, but current recipe/target
execution is routed through the
[pixi migration](./runtime-box-pixi-migration.md) and
[Scrollcase P5 adoption](./scrollcase-p5-liatir-adoption.md).

This was the execution plan for bringing scGPT Whole-human and UCE 4-layer to
the uv-era Runtime Box target matrix. It is retained for defect, run and
evidence history, not as a current command source. Scrollcase is now an
independent external build tool consumed from npm; no Scrollcase source belongs
in Liatir. The completed CI foundation and its historical evidence remain in
[Runtime Box CI foundation](./runtime-box-ci-foundation.md). Current production
facts and operator procedures remain in the
[Runtime Box production report](./runtime-box-production-report.md).

## Outcome and exact scope

The table below is the historical scope used by this ledger. It predates the
pixi CUDA identities (`linux-x86_64-cuda12.9` and
`windows-x86_64-cuda12.8`) and the self-hosted scGPT validation evidence. Use
`runtime-boxes/catalog.json` for live target identity and status.

| Target | scGPT | UCE | Scope decision |
| --- | --- | --- | --- |
| `macos-aarch64-metal` | Already published; regress after P0 | Already published; regress after P0 | In scope |
| `linux-x86_64-cpu` | New box | New box | In scope |
| `windows-x86_64-cpu` | New box | New box | In scope |
| `linux-x86_64-cuda12.4` | New box | New box | In scope |
| `windows-x86_64-cuda12.4` | Do not dispatch | Do not dispatch | Deferred under the existing hosted-driver blocker |

Completion requires six new published Runtime Boxes plus regression evidence
for the two existing macOS boxes. “All platforms” in this plan means the
current native Runtime Box product matrix: macOS arm64, Linux x86_64 CPU and
CUDA 12.4, and Windows x86_64 CPU. It does not invent support for targets that
Liatir does not currently define, such as macOS Intel, Linux arm64, WSL2, or
Windows CUDA on the blocked hosted runner.

The source and model-asset licenses are already accepted for the published
macOS boxes. Every new dependency lock still requires a target-specific license
audit because native wheels and bundled notices differ by OS and accelerator.

## Architecture boundary

This expansion must not create a workflow per OS or fork build/release logic.

- `.github/workflows/_runtime-box-validate.yml` remains the reusable validation
  workflow.
- `.github/workflows/runtime-box-release.yml` remains the single protected
  production release workflow.
- The scGPT and UCE workflows remain thin model callers. They may gain checked
  target choices and path filters, but not copied build logic.
- `runtime-boxes/catalog.json` continues to resolve recipe, runner, timeout,
  disk, validator, publication, and evidence identity.
- Each model/target gets a native recipe, hash-locked dependency graph,
  dependency audit, catalog target, and signer-policy allowlist entry. These are
  target data, not CI duplication.
- A target is never marked `published` or exposed as supported until its
  protected release and product lifecycle evidence have been reviewed.

## Mandatory operating rules

1. Work on one target at a time. Do not batch unpublished targets into one
   remote experiment.
2. Complete all local and otherwise zero-cost gates before allocating a remote
   native runner.
3. Never use a paid runner as a debugger. A failed remote run adds a recorded
   defect, root cause, regression, cleanup result, and fresh cheap-gate
   requirement before any retry.
4. Before every remote or paid dispatch, reread the exact workflow and inputs,
   state runner, timeout, maximum estimated cost, expected evidence, stop
   conditions, and rollback, and obtain explicit maintainer approval.
5. Immediately verify the created run ID, revision, model, target, mode, runner,
   and publication state. Cancel on any mismatch.
6. Use bounded background waits and report only state transitions.
7. Never dispatch `windows-x86_64-cuda12.4` while the no-dispatch decision is in
   force.
8. Keep support claims honest: `buildable` is not `published`, and scientific
   validation is not the complete product lifecycle.

## Phase P0 — shared portability correction

This required pre-step is one correction to the validators and shipped product
runners, not six CI rewrites.

### P0.1 Resolve validation from the checked recipe and target

- Make both validators consume the existing
  `LIATIR_RUNTIME_BOX_RECIPE_ID` and `LIATIR_RUNTIME_BOX_TARGET_ID` values
  supplied by `runtime-box-ci.mjs`.
- Load the checked recipe and derive runtime payload, target identity, Python
  entry point, accelerator, version, and dependency-lock provenance from it.
- Reject recipe/target mismatches before inference.
- Remove the scGPT hard-coded macOS archive name, external `unzip` command, and
  `venv/bin/python` assumption. Validate the tracked build payload directly or
  use the repository safe ZIP reader when extraction is actually under test.
- Remove UCE's hard-coded macOS runtime, recipe path, lock hash,
  `venv/bin/python`, and `/usr/bin/time -l`. Portable evidence may record
  unavailable RSS/VRAM fields as `null`; correctness must not depend on a
  host-specific memory command.

### P0.2 Make accelerator selection explicit and fail closed

- Give the scGPT and UCE product runners one consistent optional accelerator
  request: `auto`, `cpu`, `mps`, or `cuda` where applicable.
- Preserve `auto` as the product default, but make validators request the
  recipe's exact accelerator.
- Refuse unavailable or mismatched accelerators. A CUDA or Metal target that
  silently falls back to CPU must fail.
- CPU targets run and validate CPU once. Metal and CUDA targets run CPU first,
  then the required accelerator, and compare finite outputs with explicit
  model-owned tolerances.
- Record framework version, actual backend, reported CUDA compatibility, output
  shape, finiteness, parity, fixture hash, recipe, target, and lock hash.

### P0.3 Regression coverage and acceptance

Add focused tests proving that:

- POSIX and Windows interpreter paths derive from `recipe.pythonEntryPoint`;
- both validators reject target mismatch;
- neither validator invokes external `unzip` or macOS-only `time -l`;
- explicit CPU, Metal, and CUDA requests reject backend fallback;
- UCE CUDA is accepted by the product runner and checked against the device;
- validators execute the exact Python embedded in the product, not copies.

Run the repository-defined cheap gates, at minimum:

```text
npm run runtime-box:ci -- check
npm run test:unit -- <focused Runtime Box and single-cell contract tests>
npm run test:verify
npm run ts:compile:src-ts
npm run check --prefix frontend
```

Then regress the existing scGPT and UCE macOS targets. Start locally where the
payload and capacity are available. If UCE requires the ephemeral heavy runner,
use one separately approved validation-only run with its exact runner, timeout,
cost, and cleanup stated first. Do not republish macOS unless the recipe or box
payload changed; validator-only or product-runner-only changes do not require
new box bytes. P0 closes only with cheap-gate output and both macOS regression
records.

## Repeated target delivery gate

Every new target follows this sequence. Another model passing on the same OS is
not substitute evidence.

### A. Target design and legal lock

1. Confirm existing upstream source and model-asset hashes remain exact.
2. Create the native recipe using the canonical target adapter and standalone
   Python layout.
3. Generate the dependency lock for the exact native platform and Torch
   backend; never copy another OS lock.
4. Verify artifact hashes, wheel availability, absence of source builds, line
   endings, relocatability, native-library closure, and notice obligations.
5. Add the reviewed target-specific dependency audit.

### B. Checked configuration

1. Add the catalog target initially as `buildable`, with conservative disk
   estimates, checked runner, timeout, validation modes, and no publication.
2. Add the exact signer-policy target and regression test.
3. Add the target to the model caller choices and recipe path filters without
   copying workflow steps.
4. Confirm the generic release already resolves it; change shared CI only for a
   genuine shared defect.

### C. Cheap verification

Run catalog, target-adapter, signer, validator, product-runner, full verify,
TypeScript, frontend, and relevant Rust Runtime Box tests. Build locally only on
a matching host. A clean build must not rely on warm caches or generated state.

### D. Native non-production proof

After explicit approval, run the model caller in `scientific` or
`native-lifecycle` mode on the catalog-resolved runner. Require exact host/disk
probe, clean build, independent self-test, real shipped-runner inference,
correct backend, finite output, scientific provenance, compact evidence, and
cleanup. This stage uses a development signature and does not publish.

### E. Protected production release

After reviewing D and obtaining a second explicit approval, dispatch the exact
model and target through `runtime-box-release.yml`. Require:

```text
legal audit -> dependency lock -> native build -> self-test -> scientific
validation -> KMS signing -> immutable R2 publication and public hash check ->
beta promotion -> real product install/inference -> Jobs -> Results ->
provenance -> replacement/rollback/removal -> evidence -> cleanup
```

If an immutable object is uploaded but a later product gate fails, do not
promote or mark the target supported. Record the exact unpromoted state.

### F. Review and support promotion

1. Review the compact artifact and live signed channel.
2. Commit the retained evidence record.
3. Change `buildable` to `published` and add publication metadata only from the
   reviewed result.
4. Regenerate shared-core data from its source of truth where required.
5. Update compatibility, production, readiness, roadmap, this register, and the
   current status.

## Ordered delivery batches

The order prioritizes broad CPU coverage before paid GPU work and uses the
lighter scGPT box to prove portability before the much larger UCE payload.

### P1 — scGPT Linux CPU

- Target: `bowang-scgpt-whole-human` / `linux-x86_64-cpu`.
- Runner class: checked Linux x86_64 CPU runner.
- Proof: deterministic CPU embedding through the shipped runner and full Linux
  product lifecycle.
- Check Linux CPU Torch wheels, absence of CUDA dependencies, and portable
  source/package pruning.

### P2 — scGPT Windows CPU

- Target: `bowang-scgpt-whole-human` / `windows-x86_64-cpu`.
- Runner class: checked Windows x86_64 CPU runner.
- Proof: Windows interpreter layout, DLL closure, MAX_PATH-safe installation,
  real CPU embedding, and full Windows lifecycle.
- Stop on source-only dependencies or unexpected compiler builds and repair the
  lock/recipe before any retry.

### P3 — UCE CPU runner capacity gate

UCE's reviewed macOS release required `32,212,254,720` free build bytes and
produced an `8,864,908,393`-byte archive with an installed size of
`10,142,864,860` bytes. Do not assume either standard CPU runner can host it.

1. Preserve the 30 GiB requirement unless a clean measured build proves a lower
   peak without deleting required evidence or weakening the box.
2. Use a bounded capacity probe before asset download/build for candidate Linux
   and Windows runner classes.
3. If standard runners fail, add named checked larger CPU profiles with enough
   disk and bounded timeouts; never lower the catalog floor to force a pass.
4. Record ownership, concurrency, cleanup, timeout, and price. Obtain approval
   before provisioning or allocating a billable runner.

This gate selects infrastructure only; it does not establish UCE support.

### P4 — UCE Linux CPU

- Target: `snap-stanford-uce-4layer` / `linux-x86_64-cpu`.
- Runner: capacity-gate winner resolved through the catalog.
- Proof: pinned 10-cell/32-gene fixture, finite `10 x 1280` CPU output, exact
  artifacts/provenance, and full Linux lifecycle.
- Keep all eight currently supported species assets intact and remove every
  macOS-only dependency or MPS requirement.

### P5 — UCE Windows CPU

- Target: `snap-stanford-uce-4layer` / `windows-x86_64-cpu`.
- Runner: capacity-gate winner resolved through the catalog.
- Proof: Windows path handling, finite `10 x 1280` CPU output, large-archive
  installation, and complete Windows lifecycle.
- Check ZIP64 extraction, MAX_PATH margin, DLL closure, replacement/rollback
  disk, and bounded cold-start inference.

### P6 — scGPT Linux CUDA 12.4

- Target: `bowang-scgpt-whole-human` / `linux-x86_64-cuda12.4`.
- Expected runner: catalog-resolved `liatir-linux-t4`.
- Proof: explicit CUDA request, expected Torch/CUDA compatibility, actual T4
  execution, finite CPU/CUDA parity, and full GPU product lifecycle.
- Finish CPU work and cross-resolve/audit the CUDA lock before requesting one
  bounded GPU run. Quote the current price and timeout, not remembered values.

### P7 — UCE Linux CUDA 12.4

- Target: `snap-stanford-uce-4layer` / `linux-x86_64-cuda12.4`.
- Runner: checked Linux T4 profile only if disk, RAM, and VRAM probes also meet
  UCE's requirements. A T4 label alone is insufficient.
- Proof: CPU reference followed by explicit CUDA, finite `10 x 1280` output,
  tolerance/cosine parity, resource evidence, and full GPU lifecycle.
- Stop if the T4 cannot meet the real contract. Never publish CPU fallback under
  a CUDA target; record the hardware blocker and seek approval for another
  checked GPU runner.

### P8 — closure audit

1. Audit the two existing macOS boxes and six new boxes.
2. Confirm each beta channel points to a KMS-signed immutable release and every
   retained record matches catalog metadata.
3. Confirm Liatir selects only exact OS/architecture/accelerator targets.
4. Align catalog, shared core, compatibility, production report, readiness, AI
   roadmap, this plan, and current status from reviewed evidence.
5. Keep Windows CUDA visibly unsupported and prohibited from dispatch.

## Execution register

| Phase | Deliverable | State | Required closure evidence |
| --- | --- | --- | --- |
| P0 | Portable validators and explicit accelerator contract | In progress | Local implementation and cheap gates complete; two macOS regressions remain |
| P1 | scGPT Linux CPU | In progress | Corrected native lifecycle proof complete; diagnose protected signing-build failure, then release, evidence record, and beta channel remain |
| P2 | scGPT Windows CPU | Not started | Validation/release runs, evidence record, beta channel |
| P3 | UCE CPU runner capacity | Not started | Measured capacity and approved checked runner profiles |
| P4 | UCE Linux CPU | Not started | Validation/release runs, evidence record, beta channel |
| P5 | UCE Windows CPU | Not started | Validation/release runs, evidence record, beta channel |
| P6 | scGPT Linux CUDA 12.4 | Not started | T4 validation/release, CPU/CUDA parity, beta channel |
| P7 | UCE Linux CUDA 12.4 | Not started | Capacity plus T4 validation/release and parity |
| P8 | Cross-platform closure audit | Not started | Reviewed 2-model x 4-target matrix and aligned docs |

### 2026-07-22 — P0 local correction and P1 checked configuration

- Both scientific validators now resolve the selected recipe, target, payload,
  interpreter, accelerator, and dependency lock from the checked Runtime Box
  inputs. Recipe/target mismatches fail before inference, and neither validator
  depends on external ZIP extraction or macOS-only memory tooling.
- The shipped scGPT and UCE product runners accept explicit `cpu`, `mps`, and
  `cuda` requests, reject unavailable or mismatched backends, and retain `auto`
  as the normal product default. Accelerated validators establish a CPU
  reference before applying explicit finiteness and parity tolerances.
- Added the native `scgpt-whole-human-linux-x86_64-cpu` recipe, a 22-package
  hash-locked Linux CPU graph with Torch `2.4.1+cpu`, dependency audit, catalog
  target, signer identity, and thin caller wiring. The target remains
  `buildable`; it has no publication metadata or support claim.
- Lock SHA-256:
  `97d9a61da5a2530d4f69269ead81d12cc12b838acdbbdf551052e1513e298800`.
  Cross-platform installation of the exact wheels completed without source
  builds, and the lock contains no CUDA or `nvidia-*` packages.
- Cheap evidence completed: catalog/fixture check; target and release
  resolution; 12 signer-policy tests; 37 focused Runtime Box/evidence/catalog
  tests; the full `test:verify` chain with 157 unit tests and clean SDK/core,
  Svelte, frontend, and root TypeScript builds; standalone frontend TypeScript
  and Svelte checks; 11 Rust Runtime Box tests (one intentionally ignored large
  fixture); internal docs build; embedded Python syntax checks; and
  `git diff --check`.
- Remaining P0 evidence: real scGPT and UCE macOS arm64 Metal regressions.
  Remaining P1 evidence: native Linux CPU validation, protected release,
  retained evidence review, beta promotion, and product support surfaces.
- The maintainer authorized autonomous execution for this P0/P1 work while
  retaining the per-action disclosure, bounded monitoring, cost discipline,
  and no-dispatch rule for Windows CUDA.

### 2026-07-22 — P1 native validation attempt 1 stopped at dependency audit

- Validation run `29951014606` executed the exact checked tuple on commit
  `b3a9a1f`: `bowang-scgpt-whole-human`,
  `scgpt-whole-human-linux-x86_64-cpu`, `linux-x86_64-cpu`,
  `native-lifecycle`, standard `ubuntu-24.04`, no GPU. Preflight, host/disk
  probe, development key generation, the pinned Python install, all 22 locked
  wheels, and all byte-pinned assets succeeded.
- The build then stopped before self-test and inference with
  `Runtime Box license audit: installed distributions do not exactly match the
  dependency lock`. The unconditional evidence and cleanup steps passed.
  Failure artifact `8542138493` records the exact failed identity and revision;
  nothing was signed for production, uploaded to R2, promoted, or exposed.
- Root cause: the new Linux recipe inherited four historical macOS prune paths
  that removed the locked `networkx` and `sympy` package directories and their
  distribution metadata before the reviewed dependency audit. The standalone
  Linux wheel installation independently reproduced the full 22-package set
  and matched the committed audit, isolating the contradiction to pruning.
- Fix: retain both locked distributions and make the zero-cost catalog gate
  reject any audited recipe that prunes a complete lock-required package or
  its `dist-info` metadata. The focused regression, catalog check, exact target
  resolution, and JavaScript syntax check pass locally. One native retry is
  allowed only after the complete cheap gate passes on the fix revision.
- Actual billed-runner exposure was approximately one rounded Linux minute for
  preflight plus one for the native job: at most `$0.012` beyond included
  minutes at the reviewed `$0.006/minute` standard Linux rate.

### 2026-07-22 — P1 native validation attempt 2 reached product lifecycle

- Validation run `29951632568` on fix commit `ef7744f` passed the checked
  preflight, Linux host/disk probe, 22-package dependency audit, clean native
  build, development signature verification, archive/layout verification, and
  self-test. The measured archive is `497,682,872` bytes with SHA-256
  `91024613948d6a288948406c8eddd6ec89275d0691d27a3fb0dcaf49b017194b`;
  installed size is `1,261,955,005` bytes.
- The exact shipped scGPT runner then completed real CPU inference against the
  pinned one-cell/128-gene fixture in `158,223` ms, producing one finite
  512-dimensional embedding on Torch `2.4.1+cpu`. Output and provenance
  contracts passed. Failure artifact `8542504315` retains this evidence.
- The run stopped only when the generic Rust product lifecycle attempted to
  compile Tauri: `_runtime-box-validate.yml` had not installed the Linux
  GLib/WebKit/GTK development libraries already required and proven by the
  protected release workflow. `glib-sys` therefore failed because
  `glib-2.0.pc` was unavailable. Evidence writing and cleanup passed; nothing
  was published or promoted.
- Fix: one shared Linux lifecycle dependency script now owns the proven package
  set and is called by reusable validation, protected release, and foundation
  CI. The validation step runs only for Linux `native-lifecycle` mode and before
  Rust compilation. Model callers track the shared script in their path
  filters. Bash syntax, workflow contract tests, catalog/signer checks, internal
  docs build, diff check, and the full 157-test `test:verify` gate pass locally.
  One bounded native proof is allowed on the committed fix.
- Actual billed-runner exposure was approximately one rounded Linux minute for
  preflight plus six for the native job: at most `$0.042` beyond included
  minutes at the reviewed standard Linux rate.

### 2026-07-22 — P1 native validation attempt 3 exposed rollback ordering

- Validation run `29952407546` on shared-dependency fix commit `cb89e6b`
  passed the exact checked preflight, Linux host/disk probe, clean build,
  dependency audit, archive verification, independent self-test, and real
  scGPT CPU scientific validation. The shared Linux system-dependency installer
  also worked: the Tauri application compiled successfully in the product
  lifecycle job. Artifact `8543003240` and the unconditional cleanup step were
  retained; no production signing, R2 publication, promotion, or catalog
  support change occurred.
- The Rust lifecycle ran 11 production-transition tests: 10 passed, the
  established large fixture was ignored, and
  `runtime_box_activation_rollback_and_remove_use_production_transitions`
  failed because rollback restored `first` instead of the directly previous
  `second` generation.
- Root cause: activation created the correct uniquely named backup, but then
  discarded that identity and pruned rollback candidates by filesystem
  modification time. Consecutive Linux directory renames can have equal
  timestamps, so the retained generation was nondeterministic.
- Local fix: pruning now retains the exact backup path produced by the current
  activation and removes every other candidate. A direct multi-candidate
  regression plus the formerly failing lifecycle test pass; the complete
  Runtime Box Rust module passes 11/11 with the large fixture intentionally
  ignored. Catalog, signer 12/12, internal docs, and the full verify chain also
  pass, including 157/157 unit and contract tests, SDK/core generation, Svelte,
  frontend production build, and root TypeScript compilation.
- `cargo fmt --check` remains unusable as a repository-wide gate because the
  existing Rust tree has extensive unrelated formatting drift; it made no
  changes. The task diff itself is whitespace-clean.
- The native target remains `buildable` and unpublished. One corrected Linux
  lifecycle recheck is still required before the protected release can be
  considered. Approximate billed-runner exposure for this attempt was one
  rounded preflight minute plus fourteen native minutes, at most `$0.090`
  beyond included minutes at the reviewed standard Linux rate.

### 2026-07-22 — P1 corrected native proof passed; first protected release stopped before publication

- Validation run `29954604079` on exact clean commit `29d3ad1` passed the full
  `native-lifecycle` chain on standard `ubuntu-24.04`: checked preflight and
  host capacity, clean build, 22-package audit, development signature and
  archive verification, independent self-test, real scGPT CPU inference, all
  Rust Runtime Box lifecycle tests, compact evidence upload, and cleanup.
- Reviewed artifact `8543832402` has digest
  `sha256:43a819e5f7d577feadfbfb987ab6eb6f2f0fe6cc73c0d36c33bf016c613e7fef`.
  It records archive SHA-256
  `5fa834ec3002e2ad1c71de5392319406c32fe206419b46f074a5790ecc416900`,
  archive size `497,682,872`, installed size `1,261,955,005`, Torch
  `2.4.1+cpu`, and a finite `1 x 512` embedding from the pinned one-cell,
  128-gene fixture. Output and provenance contracts passed. Approximate
  billed-runner exposure was one rounded preflight minute plus thirteen native
  minutes: at most `$0.084` beyond included minutes.
- Protected release run `29955615971` then used the same exact commit, model,
  Linux CPU target, and beta channel. Protected input resolution, host and disk
  probe, GitHub OIDC authentication, gcloud setup, Linux lifecycle dependencies,
  Rust 1.95, and the clean-revision check all passed. The run failed in `Build
  with the private KMS signer and verify locally`. Scientific validation,
  immutable R2 publication, product lifecycle, and beta promotion were never
  reached. Unconditional evidence writing, artifact upload, credential cleanup,
  and build-state cleanup passed. Approximate exposure was one preflight minute
  plus three release minutes: at most `$0.024` beyond included minutes.
- **DIAGNOSED 2026-07-24 — root cause: deployed-signer policy drift, not a build
  defect.** The log of failed job `89043938345` carries one error line:
  `runtime-box: Remote Runtime Box signing failed (400):
  {"error":"signing_rejected","message":"target is not approved for this box"}`.
  The rejection comes from the private Cloud Run signer's own policy, not from the
  builder. The repository's `services/runtime-box-signer/policy.json` **does**
  list `scgpt-whole-human → linux-x86_64-cpu`; it was added by `b3a9a1f`
  (2026-07-22 21:25 +0200), which **is an ancestor** of the released commit
  `29d3ad1` (22:06 +0200). So the committed policy was correct and the run still
  failed: the **deployed** Cloud Run revision was serving an older policy, because
  committing `policy.json` does not deploy it — `npm run runtime-box:signer:deploy`
  was never run after `b3a9a1f`.
  - **Fix before any retry:** deploy the signer so the served policy matches the
    repository, then re-run the protected release. No builder change is required
    and no code regression exists to write.
  - **Systemic gap CLOSED 2026-07-24.** The release workflow now fails fast if the
    deployed signer policy is stale, before any paid build. The signer exposes a
    content fingerprint of its baked-in policy on `GET /health`
    (`runtimeBoxPolicyFingerprint`, a canonicalized SHA-256 that ignores key order
    and whitespace); a new `runtime-box:ci -- verify-signer-policy` step, wired in
    right after GCP auth and before `Build with the private KMS signer`, reads that
    fingerprint and compares it to the committed `policy.json`. On a mismatch it
    exits non-zero with the exact remedy (`runtime-box:signer:deploy`). This turns
    the wasted-run failure mode into a ~1s gate. Note it does **not** auto-deploy
    the signer: deploying uses a separate admin service account in the
    `runtime-box-signer-admin` environment, and giving the release job that power
    would collapse the privilege separation that protects the key. The operator
    still runs the deploy; the check just guarantees a release can never silently
    proceed against a stale one. Covered by the signer policy tests and
    `tests/unit/runtime-box-signer-policy-drift.test.ts`.
  - The target remains `buildable`, unpublished, unpromoted, and unsupported.
- The automatic foundation run `29953770028` on `29d3ad1` passed shared
  contracts, deterministic Zip64 extraction, and Linux/macOS native fixtures,
  but its Windows fixture repeated the pre-existing relocatable-console-launcher
  failure: it attempted to spawn
  `venv\\Scripts\\liatir-lock-fixture.exe` and received `ENOENT`. This is
  separate from Linux P1 and is tracked for the Windows/P2 portability work;
  it must not be hidden or treated as a rollback regression.

## Per-action checklist template

Before each material implementation or dispatch, record:

- **Prerequisites/current state:** clean revision, prior evidence, free disk,
  credentials boundary, and runner availability.
- **Exact action:** file/command or workflow, revision, model, recipe, target,
  mode, channel, runner, and timeout.
- **Expected state change:** generated lock/build/evidence or publication state.
- **Success evidence:** output, diff, run/job IDs, artifact digest, release hash,
  channel response, lifecycle report, and cleanup result.
- **Stop conditions:** identity mismatch, dirty revision, insufficient disk,
  backend fallback, audit gap, scientific mismatch, unexpected publication, or
  cleanup failure.
- **Rollback/cleanup:** generated paths, unpromoted objects, channel state,
  runner deregistration, and retained diagnostics.
- **Cost/authorization:** runner class, maximum duration, maximum estimated
  price, and explicit approval where required.

## Definition of done

This program is complete only when scGPT and UCE are both published and
product-validated on macOS arm64 Metal, Linux x86_64 CPU, Linux x86_64 CUDA
12.4, and Windows x86_64 CPU; all support surfaces agree with reviewed evidence;
and Windows CUDA remains excluded until its separate blocker is resolved.
Recipe existence, successful import, or a signed archive without scientific and
product lifecycle evidence is not completion.
