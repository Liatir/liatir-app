# Runtime Box model platform expansion

Last reviewed: 2026-07-22

Status: **in progress — P0 local correction and P1 Linux CPU checked configuration complete**

This is the canonical execution plan for bringing scGPT Whole-human and UCE
4-layer to every currently supported native Runtime Box product target where
the model is technically and legally viable. The completed CI foundation and
its historical evidence remain in
[Runtime Box CI foundation](./runtime-box-ci-foundation.md). Current production
facts and operator procedures remain in the
[Runtime Box production report](./runtime-box-production-report.md).

## Outcome and exact scope

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
| P1 | scGPT Linux CPU | In progress | Buildable recipe/configuration and cheap gates complete; native validation/release, evidence record, and beta channel remain |
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
  tests; the full `test:verify` chain with 156 unit tests and clean SDK/core,
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
