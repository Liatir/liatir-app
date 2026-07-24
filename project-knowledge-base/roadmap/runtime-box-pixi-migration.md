# Runtime Box CI migration → pixi + pixi-pack + conda-forge (self-hosted GHA)

Last reviewed: 2026-07-24

Status: **Phase 0 DONE on every OS (macOS Metal + Windows CPU/CUDA + Linux CPU/CUDA); Phases 1–5
not started.** The zero-cost local Phase 0 spike is complete and decisive on macOS, on the harder
no-rpath Windows case (CPU + CUDA, real RTX 4060 Ti compute), and on linux-64 (CPU + CUDA, same GPU
via WSL2) — see [Phase 0 decision record](./runtime-box-pixi-phase0-spike.md). **No activation env
is required on any OS.** No production code has changed. Implementation of Phases 1+ begins only on
explicit maintainer go-ahead, one phase at a time. Note the **per-OS** CUDA pin corrections below:
win-64 → 12.8, linux-64 → 12.9.

Related plans: [Runtime Box model platform expansion](./runtime-box-model-platform-expansion.md)
(the model/target re-validation this migration feeds into),
[Runtime Box CI foundation](./runtime-box-ci-foundation.md) (the historical uv-based
foundation being replaced), and [Runtime Box production report](./runtime-box-production-report.md)
(the trust/distribution spine that stays unchanged).

## Context

The Runtime Box AI packaging system currently builds each box with a hand-rolled
**uv + python-build-standalone + custom relocatability** stack. The incident ledger in
`runtime-box-ci-foundation.md` shows this layer is the single biggest source of engineering
cost and failed remote runs: PE-launcher relocatability, MAX_PATH, CRLF/LF, `npm.cmd`/`npx.cmd`
spawning, DLL closure, interpreter-layout, per-OS system-lib scripts, dependency pruning, and
per-platform license audits.

**Decision:** replace the box **builder** with **pixi + pixi-pack + conda-forge** as the
default (Variant A), with a contained, documented `[pypi-dependencies]` escape hatch only for
framework/OS combos conda-forge genuinely cannot cover. Keep the entire **trust/distribution
spine unchanged** (R2 publication, KMS signing via OIDC→Cloud Run→KMS, catalog, evidence, the
build-in-CI-then-ship-a-validated-immutable-box model). Run CI on **GitHub Actions self-hosted
ephemeral runners** on the maintainer's own macOS/Windows/Linux+CUDA machines (free minutes,
unblocks Windows CUDA which the hosted runner's old driver could not do). Standardize **torch
on 2.8.0** across every target, and **re-validate scientifically**. Rebuild **all** boxes
including the two already-published macOS ones for a single uniform substrate.

Decisions locked with the maintainer (2026-07-23):

- Variant **A** (all conda-forge) as default + a contained PyPI escape hatch.
- torch standardized on **2.8.0** across every target (conda-forge has full linux/win/macOS
  CPU+CUDA coverage from 2.5.1; 2.8.0 chosen for future-proofing).
- **Rebuild all** boxes now, including the two published macOS ones — one uniform substrate.
- CI on **GHA self-hosted ephemeral runners** (one channel, not a local+GHA hybrid), keeping
  R2/KMS/catalog/evidence intact.

Supporting availability findings and rationale live in the machine-checked memory
`pixi-migration-decision` and `external-tooling-scan`. Key facts: models vendor their
inference code (no `geneformer`/`scgpt`/`uce` pip package), so the dependency set is all
mainstream and conda-forge-coverable; TensorFlow (future Enformer/Basenji2/Borzoi) has no
conda-forge Windows build → that is the reserved PyPI-escape-hatch case; celltypist needs the
bioconda channel.

Intended outcome: far less bespoke packaging code, far cheaper/faster iteration, uniform
cross-platform coverage from one source, and an easier, lower-overhead path to Cloudflare —
without weakening scientific reproducibility, signing, or provenance.

## Invariants — must NOT change

- R2 publication, KMS signing (key never on any local machine; the OIDC id_token is minted by
  GitHub Actions regardless of where the self-hosted runner executes), catalog-driven
  resolution, the evidence contract, `target-id-contract.json`, and the "validate the exact
  box, then sign, then publish immutable bytes" model.
- **Interpreter convention:** name the packed pixi prefix `venv/` so the existing Rust resolver
  keeps working unchanged — a conda prefix is `venv/bin/python` (Unix) and `venv/python.exe`
  (Windows root), which is exactly what `venv_python_for` (`src-tauri/src/bridge/python_env.rs`)
  already probes, and matches `pythonEntryPoint`.
- One target at a time; all cheap/local gates green before any runner; explicit approval and a
  stated cost/stop-condition before every dispatch (even self-hosted, for discipline).
- No paid GitHub-hosted GPU runners once self-hosted is live.

## Phase 0 — Relocation/activation spike (LOCAL, zero-cost, GATES everything)

**Predicted complexity: Low–Medium** — small hands-on POC, but its outcome is decisive and gates Phases 1–2.

> **DONE 2026-07-24 on macOS Metal, win-64 CPU/CUDA and linux-64 CPU/CUDA. Outcome — full record:
> [runtime-box-pixi-phase0-spike.md](./runtime-box-pixi-phase0-spike.md).** Decision:
> **conda-pack** is the relocation mechanism (rides inside the existing ZIP + `box.json` + signing
> flow, no new external runtime dependency). **No activation env is required on any OS** — a
> relocated conda-forge prefix imports the whole scGPT set under a fully empty environment and runs
> accelerator compute (Metal on macOS; a real CUDA matmul on the RTX 4060 Ti on both Windows and
> Linux), so `run_self_test` and the Rust run path stay activation-free everywhere.
> Box layout: extracted prefix named `venv/` (keeps the `venv/bin/python` invariant). Footprints
> ≈ 833 MB (macOS) / ≈ 1.35 GB (win CPU) / ≈ 6.5 GB (win CUDA) / ≈ 1.63 GB (linux CPU) /
> **≈ 9.5 GB (linux CUDA, the largest box in the matrix)** — size the Phase 1 `diskPlan` floors
> from the Linux CUDA figure. The Phase 2 manifest `activation` field stays **optional/nullable**
> and `null` for every current target. The per-OS caveat is closed; the only residual is that the
> Linux CUDA proof ran under WSL2's driver bridge (see the record) — re-confirm cheaply if the
> Phase 3 Linux CUDA runner is bare metal.
>
> **SUPERSEDED detail:** the embedded `conda-unpack` fixer is **not** run — see the Phase 2 note in
> the decision record. Boxes ship without it and the Rust install flow needs no relocation step.

The one genuinely unknown risk: a conda/pixi environment needs a one-time **prefix relocation**
after extraction to a new location, and conda libraries (e.g. torch) **may require environment
activation** (env vars / library paths) to import — whereas today's self-test runs `python -c`
with no env (`run_self_test`, `src-tauri/src/bridge/runtime_boxes.rs`).

Do this first, by hand, on one target (macOS Metal or Linux CPU):

1. `pixi` create an env for scGPT deps at torch 2.8.0 from conda-forge, prefix named `venv`.
2. Pack it two ways and compare: (a) **pixi-pack** `environment.tar` + `pixi-unpack`;
   (b) **conda-pack** with the self-contained embedded `conda-unpack` (rides inside the box, no
   external binary at install).
3. Extract to a *different* absolute path (simulate a real user prefix) and answer:
   - Does `venv/bin/python -c "import torch, scipy, anndata, ..."` work **cold, with no
     activation env**? Or does it need `CONDA_PREFIX` / `PATH` / `DYLD_/LD_LIBRARY_PATH`?
   - What is the **minimal** activation env, if any?
   - Which relocation mechanism fits our extract→self-test→rename-activate flow best, and at
     which step must relocation run relative to the staging→final rename?
4. **Output:** a decision record (which tool, exact on-disk box layout, whether Rust execution
   must inject an activation env) that fixes the shape of Phases 1–2.

**Recommended default (revisit after the spike):** conda-pack-style embedded self-contained
unpack, because it keeps the box self-contained (no new external runtime dependency) and rides
inside the existing ZIP + `box.json` + signing flow. Fall back to pixi-pack + a bundled pinned
`pixi-unpack` binary (via the existing `managed_bins` infra) if conda-pack cannot pack a
pixi-created env cleanly.

## Phase 1 — Build layer: pixi replaces uv (Node tooling)

**Predicted complexity: High** — substantial rewrite of the core build tooling, a new recipe/lock format, and a reworked conda-based license audit.

> **Progress (2026-07-24) — pixi build path proven end-to-end on the scGPT macOS pilot.**
> Implemented incrementally, keeping the uv and pixi paths coexisting so every cheap gate stays
> green (invariant: one target at a time, gates green).
>
> - **Increment 1 (done):** additive substrate — `condaSubdir` + `runtimeBoxCondaSubdir` +
>   `runtimeBoxPixiAccelerator` in `targets.mjs`; new `scripts/runtime-box/pixi.mjs` (`findPixi`,
>   `findCondaPack`, lock/install/conda-pack arg builders, `installAndPackPixiEnvironment`); unit
>   tests (`runtime-box-pixi.test.ts` + adapters); pilot `pixi.toml` + `pixi.lock` (regenerated
>   byte-identical to the maintainer-pushed lock → resolution reproducible).
> - **Increment 2 (done):** `buildRecipe`/`lockRecipe` branch on `recipe.pixiVersion`. The pixi
>   path runs `pixi install --frozen` → `conda-pack` → extract into `venv/` → run the embedded
>   `conda-unpack` with the box's own interpreter → **dereference every symlink in place** (the
>   archive layer rejects links; `collectFiles`/`normalizeTree`/the ZIP writer, and the uv path
>   already dereferences when staging). Provenance emits `pixiVersion` + `dependencyLockSha256` =
>   sha256(pixi.lock); the `.dist-info` audit is skipped on the pixi path (conda audit is
>   increment 3). Recipe keeps its uv fields transitionally (so the catalog check, which validates
>   `requirementsLock`, stays green) and adds `pixiVersion: 0.73.0`.
> - **Verified:** a real end-to-end build produced a signed scGPT macOS box — `pixi install` →
>   conda-pack → venv → self-test **passed** (imports **and** `best_model.pt` shape asserts on
>   torch 2.8.0) → deterministic ZIP → signed release + channel. `verify --self-test` re-extracts
>   and re-imports cleanly. Payload has **0 symlinks**; `box.json` provenance carries `pixiVersion`,
>   no `uvVersion`. Gates: full unit suite 163/163, catalog check, `git diff --check` all green.
> - **diskPlan finding:** dereferencing inflates the prefix from ~833 MB (conda env with symlinks)
>   to **1.9 GB** (archive 625 MB). This ≈2.3× inflation scales badly for large boxes (the Windows
>   CUDA env is ~6.5 GB with symlinks → ~13 GB dereferenced). **Decision (maintainer, 2026-07-24):**
>   keep the simple, proven full-dereference approach and raise the disk floors; revisit
>   safe-in-tree-symlink support in the archive layer (JS + Rust) only if box sizes become a real
>   user problem.
> - **Increment 3a (done):** raised the scGPT macOS `diskPlan` floors in `catalog.json` to the
>   measured pixi footprint (installed 2.5 GiB, archive 640 MiB, margin 4 GiB, required build disk
>   8 GiB); catalog check green.
> - **Increment 3b (done):** `validator-context.mjs` resolves `pixi.lock` (dependencyLockSha256 =
>   sha256(pixi.lock)) for pixi recipes, requirements.lock otherwise; unit test added.
> **Remaining Phase 1 work — tracked so it is not lost:**
>
> - **Increment 3c (done): conda license audit.** `licenses.mjs` gained `lockedCondaDistributions`
>   / `createCondaDependencyLicenseAudit` / `validateCondaDependencyLicenseAudit` +
>   `parseCondaPackageReference`. Key simplification vs the original plan: **pixi.lock already
>   carries the SPDX `license` of every package** (conda name/version from the filename, pypi from
>   fields), so the audit is a pure, deterministic function of the committed lock — no built prefix
>   needed, and it stays validatable by the cheap CI `check`. `pixi install --frozen` guarantees the
>   installed set equals the lock (a rebuild confirmed 100 `conda-meta` files == 100 audit
>   packages). New kind `liatir.runtime-box.conda-dependency-license-audit`; reviewed audit committed
>   at `legal/audits/scgpt-whole-human-macos-arm64-metal.json` (100 packages, all licensed);
>   recipe references it via `condaDependencyLicenseAudit`; `buildRecipe` validates it and writes
>   `THIRD_PARTY_NOTICES/conda-distributions.json` into the box (confirmed by rebuild). Unit-tested
>   in `runtime-box-conda-licenses.test.ts`. No YAML dep taken (targeted line-parser, matching the
>   uv audit's regex-parse idiom).
> - **Increment 3d (done): CI catalog accepts pixi recipes.** `validateRuntimeBoxCiCatalog` now
>   branches on `recipe.pixiVersion`: the uv and pixi lock/audit validations are extracted into
>   `validateUvRecipeLockAndAudit` / `validatePixiRecipeLockAndAudit`. The pixi branch validates the
>   committed `pixi.lock` hash (== `target.dependencyLockSha256`) and the reviewed conda audit
>   (identity + package set == `lockedCondaDistributions(pixi.lock)` + license/source completeness);
>   it deliberately has no prune-vs-lock guard (the conda audit is lock-derived and lists the full
>   set, so pruning transitive deps is allowed). The scGPT macOS catalog entry now pins
>   `dependencyLockSha256` = sha256(pixi.lock) and carries `condaDependencyLicenseAudit`. Catalog
>   check green (it now exercises the pixi branch for that target).
> - **Increment 3e (done): dropped the transitional uv fields.** Removed `uvVersion`,
>   `requirementsInput`, `requirementsLock` from the scGPT macOS recipe and `git rm`'d
>   `requirements.in`/`requirements.lock`; set `pythonVersion` to the value pixi actually installs
>   (3.11.15). Threaded the pixi-vs-uv lock choice through the last unconditional reader
>   (`evidence.mjs`, was `recipe.requirementsLock`). Byte-pinned `pixi.lock` + `pixi.toml` to
>   `eol=lf` in `.gitattributes` — a real gap the cost-controls test surfaced: the pixi.lock hash is
>   pinned in the catalog/provenance/audit, so an unpinned CRLF checkout on Windows would have broken
>   it. Updated that test to check the substrate's lock. **The scGPT macOS pilot is now a pure pixi
>   recipe** (`pixi.toml` + `pixi.lock` + `recipe.json`, no uv artifacts). Full unit suite 168/168,
>   catalog check, docs build all green.
>
> **Phase 1 status: the scGPT macOS pilot is fully migrated and proven on the pixi substrate.** The
> uv build path still exists for the not-yet-migrated recipes (Geneformer ×5, scGPT Linux, UCE);
> deleting the uv code entirely is a later cleanup once every recipe is on pixi (Phase 5 rebuilds).
> Remaining broadly: Phase 2 (Rust/core provenance + install-flow), Phase 3+ (self-hosted CI), and
> Phase 5 (per-target rebuild/re-validation) per the sections below.

Replace the uv/relocatability layer; keep the recipe/catalog *contract* shape (adapted).

- **Recipe schema** (`runtime-boxes/recipes/<id>/recipe.json`): drop `uvVersion`, `torchBackend`,
  `requirementsInput`, `requirementsLock`. Add a per-recipe **`pixi.toml` + `pixi.lock`**
  (conda-forge + bioconda channels; conda deps; optional `[pypi-dependencies]` escape hatch), a
  `pixiVersion` pin, and `condaSubdir` (`linux-64`/`win-64`/`osx-arm64`). Keep `pythonEntryPoint`
  (now `venv/bin/python` or `venv/python.exe`), `assets`, `localFiles`, `selfTest`,
  `modelCacheSubdir`, `sourceRevision`, `compatibility`.
- **`scripts/runtime-box/python.mjs`**: delete `stageStandalonePython`,
  `syncLockedPythonDependencies`, `posixLauncherBody`/`repairPosixLaunchers`,
  `findPythonRelocationLeaks`, `validateRelocatablePython`. Replace with: `pixi install` into the
  `venv` prefix from the locked `pixi.lock`, then produce the relocatable pack (per Phase 0
  outcome). conda handles relocation → the launcher-repair/leak-scan code goes.
- **`scripts/runtime-box/targets.mjs`**: replace `runtimeBoxTorchBackendArguments` and
  `runtimeBoxLockArguments`/uv-platform mapping with pixi platform mapping (conda subdir per
  target) and accelerator handling (cuda via conda `cuda-version` + pytorch gpu variant; cpu;
  metal via the osx-arm64 build). Keep `runtimeBoxTargetId`, native-host and entry-point asserts,
  and `ARCHIVE_BACKEND`.
- **`scripts/runtime-box.mjs`**: `lockRecipe` → `pixi lock`; in `buildRecipe` swap the
  stage/sync/relocate steps for pixi build + pack; **keep** asset download (`downloadVerified`),
  prune (revisit — conda envs prune differently), `box.json`, `normalizeTree`,
  `createDeterministicZip`, hashing, signing, and channel-document generation. `findUv` →
  `findPixi` (+ `findPixiPack`/conda-pack) with exact-version pins.
- **`scripts/runtime-box/licenses.mjs`**: rework the "installed distributions must exactly match
  the lock" audit for `pixi.lock` (conda **and** pypi packages). Read conda license metadata from
  each package's `info/about.json` / `info/licenses/` instead of `*.dist-info/METADATA`. New audit
  record shape under `legal/audits/*.json`.
- **`scripts/runtime-box-ci.mjs`**: `check` validates the `pixi.lock` hash + the conda/pypi
  package set and the reworked audit; rework `lockedDistributionPrunePaths`; update
  `runtimeBoxBuildDiskPlan` for (larger) conda-env footprints. `resolve`/`release-resolve` emit
  self-hosted outputs for every runner profile (not just macOS heavy).
- **`scripts/runtime-box/validator-context.mjs`**: resolve `pixi.lock` + the `venv` prefix instead
  of `requirementsLock`; `dependencyLockSha256` = sha256 of `pixi.lock`.

## Phase 2 — Box format + Rust/core install layer (depends on Phase 0)

**Predicted complexity: High** (Medium if the Phase 0 spike shows no activation env is required) — Rust install-flow plus cross-language contract changes.

> **DONE 2026-07-24 — and it turned out to need no Rust change at all.** Two findings collapsed the
> predicted complexity:
>
> 1. **Provenance is opaque in Rust.** `runtime_boxes.rs` stores provenance as `serde_json::Value`,
>    so the `uvVersion`→`pixiVersion` switch is a TypeScript-only contract change. Done in
>    `packages/liatir-core/src/runtime-box.ts`: `uvVersion?` / `pixiVersion?` (exactly one present)
>    on `LiatirRuntimeBoxBuildProvenance` and `LiatirRuntimeBoxCiBuildEvidence`; `dist/` regenerated.
>    A shared `runtimeBoxBuilderVersionFields` helper (`identity.mjs`) keeps the uv/pixi branch in
>    one place, applied to the build provenance, the CI evidence record, the CI workflow outputs
>    (now emitting both `uv_version` and `pixi_version`), and the scGPT validator — the last of which
>    was silently reading a field increment 3e had just removed.
> 2. **No relocation step is needed, and running one is harmful.** See the superseded note in the
>    [Phase 0 record](./runtime-box-pixi-phase0-spike.md): `conda-unpack` re-stamps the build path
>    into the box (0 → 36 files on a probe). The build now never runs it, deletes the service files
>    that carry the build prefix, and repairs conda console-script shebangs via the uv path's
>    `repairPosixLaunchers` (extended to conda's trampoline dialect, unit-tested). A rebuilt box has
>    **zero** build/developer-path occurrences. **No `activation` field was added** to the manifest:
>    Phase 0 proved none is needed on macOS or Windows (CPU + CUDA).
>
> Gates: full unit suite 169/169, `cargo test runtime_box` 12/12, catalog check, `lint:ts` clean,
> plus a real rebuild + `verify --self-test`. `venv_python_for` needs no change (a conda prefix is
> `venv/bin/python` on Unix and `venv/python.exe` at the root on Windows, which its existing probes
> already resolve) — to be re-confirmed when the first Windows pixi box is built.

- **`packages/liatir-core/src/runtime-box.ts`**: in `LiatirRuntimeBoxBuildProvenance` swap
  `uvVersion`→`pixiVersion`, `dependencyLockSha256` = pixi.lock hash. If the spike shows
  activation is required, add an `activation` field to `LiatirRuntimeBoxReleaseManifest` (env
  vars / activation strategy) so Rust knows how to run the interpreter.
- **`src-tauri/src/bridge/runtime_boxes.rs`**: add a **relocation step** after extraction and
  before `run_self_test` (run the embedded unpack fixer, or bundled `pixi-unpack`), targeting the
  final prefix. If activation env is required, thread it through `run_self_test` and the run-time
  execution path. Mirror the new manifest `activation` field in `ReleaseManifest`/
  `ExtractedBoxMetadata`. **Keep** archive verify, Zip64 extract, `.stg-{uuid}` short staging
  (MAX_PATH still applies — conda trees are deep too), `rename_with_retry`, deterministic rollback
  prune, content-addressed download.
- **`src-tauri/src/bridge/python_env.rs`**: `venv_python_for` stays if the prefix is named `venv`
  (verify the conda Windows/Unix layout matches its probes). If activation env is required,
  `spawn_in_env`/`run_in_env`/`status_env` must inject it before executing python.
- **`src-tauri/src/bridge/ai_runtime.rs`**: apply the same activation env to direct AI runs.

## Phase 3 — CI on self-hosted ephemeral runners

**Predicted complexity: Medium** — mostly config + scripting reusing the Gate 9 pattern; the new Windows PowerShell launcher is the main new piece.

- **Runner launcher:** generalize `scripts/run-runtime-box-macos-heavy-runner.sh` into a cross-OS
  ephemeral launcher (keep its contract: dedicated root outside the checkout, marker file, disk
  floor, online-time cap, single-concurrency, auto-deregister + full cleanup, `--ephemeral
  --disableupdate`). Add a Windows PowerShell equivalent. Pin the runner version + archive sha256
  per OS.
- **`runtime-boxes/catalog.json`:** add `selfHosted` blocks to the Linux and Windows runner
  profiles (only `macos-arm64-heavy` has one today); introduce generalized self-hosted labels
  (e.g. `liatir-linux-selfhosted`, `liatir-linux-cuda-selfhosted`, `liatir-windows-selfhosted`,
  `liatir-windows-cuda-selfhosted`); retire the paid `ubuntu-24.04`/`windows-2025`/
  `liatir-linux-t4`/`liatir-windows-t4` usages for native jobs.
- **Workflows:** `_runtime-box-validate.yml` and `runtime-box-release.yml` already resolve
  `runs-on` from the catalog — repoint via the catalog only. The OIDC→KMS signing path is
  unchanged. Repoint/retire the two CUDA-preflight workflows and the foundation workflow runners.
  Keep `validateRunnerExecutionContext` (name-prefix + `RUNNER_ENVIRONMENT`) and extend it to the
  new self-hosted profiles.
- **Windows CUDA re-scope:** self-hosted on the maintainer's RTX 4060 Ti (compute 8.9; driver
  591.86, CUDA 13.1-capable) removes the hosted-driver blocker. Bring the Windows CUDA target back
  into scope as now-feasible (update the `windows-cuda-blocker-and-decision` memory and the ledger).
  **CUDA-version correction (from the Phase 0 spikes) — the pin is PER-OS, do not share one value:**
  conda-forge's CUDA `pytorch 2.8.0` is a **cuda128** build for win-64 (`cuda-version >=12.8,<13`)
  but a **cuda129** build for linux-64 (`cuda-version >=12.9,<13`); pinning 12.8 on linux-64 does
  not solve at all, and there is no 12.4 build on either. Pin **Windows CUDA → 12.8** (rename
  `windows-x86_64-cuda12.4` → `windows-x86_64-cuda12.8` wherever it appears) and **Linux CUDA →
  12.9** (rename `linux-x86_64-cuda12.4` → `linux-x86_64-cuda12.9`). conda ships the CUDA runtime,
  so only the driver must be current; the packages declare merely `__cuda >=12`, which every R525+
  driver satisfies.

## Phase 4 — Validator hardware generalization (for the local RTX 4060 Ti)

**Predicted complexity: Low** — focused, well-scoped change to the CUDA validator and the runner GPU contract.

- **`scripts/ai-validation/geneformer-parity.py`:** replace `EXPECTED_T4_MODEL`,
  `EXPECTED_T4_CAPABILITY (7,5)`, `MINIMUM_T4_MEMORY_BYTES` and the single-GPU/T4 asserts with
  "compute capability ≥ target and adequate VRAM", derived from the actual GPU; keep the
  scientific tolerances (cosine ≥ 0.99999). Stop hard-stamping "Tesla T4"/"7.5" into the evidence.
- **`runtime-boxes/catalog.json` runner profiles + `probeHost` (`runtime-box-ci.mjs`):** replace
  `expectedGpuModel`/`expectedComputeCapability`/`minimumGpuMemoryBytes` with a generalized
  min-compute + min-VRAM contract.
- scGPT/UCE validators (`validate-scgpt-runtime.mjs`, `validate-uce-runtime.mjs`) are already
  hardware-agnostic — no change.

## Phase 5 — Re-validation (one model/target at a time)

**Predicted complexity: High (operational)** — low per-step code complexity, but long and iterative: rebuild + re-validate the full matrix one target at a time, re-establishing scientific baselines.

For each target: regenerate `pixi.lock` at torch 2.8.0 (conda-forge + bioconda), rebuild the
license audit, add/flip the catalog target to `buildable`, run cheap gates → local self-hosted
native validation → protected release (KMS sign, R2 publish, beta) → review evidence → flip to
`published`. Scientific baselines/tolerances are **re-established** on torch 2.8.0 (numbers may
shift; re-pin fixtures — accepted).

- **Verify the vendored model code runs on torch 2.8.0 first** (local, free), especially UCE
  (2.1.1 → 2.8.0 is the biggest jump; scGPT/Geneformer 2.4.1 → 2.8.0 smaller).
- **Order:** pilot on **scGPT Linux CPU** (lightest, PyTorch, already mid-flight), then the rest,
  per the sequencing in `runtime-box-model-platform-expansion.md`, extended to rebuild the two
  published macOS boxes and (now feasible) Windows CUDA. Full matrix to rebuild:
  {Geneformer, scGPT, UCE} × {macOS Metal, Linux CPU, Linux CUDA, Windows CPU} + Windows CUDA
  where feasible.

## Representative files

- Build tooling: `scripts/runtime-box.mjs`, `scripts/runtime-box-ci.mjs`,
  `scripts/runtime-box/{python,targets,licenses,validator-context,archive}.mjs`.
- Recipes/catalog: `runtime-boxes/recipes/<id>/{recipe.json,pixi.toml,pixi.lock}`,
  `runtime-boxes/catalog.json`, `runtime-boxes/legal/audits/*.json`.
- Rust/core: `src-tauri/src/bridge/{runtime_boxes,python_env,ai_runtime,managed_bins}.rs`,
  `packages/liatir-core/src/runtime-box.ts`.
- CI/runners: `.github/workflows/{_runtime-box-validate,runtime-box-release,runtime-box-foundation,
  runtime-box-*-cuda-preflight}.yml`, `scripts/run-runtime-box-*-runner.sh` (generalized).
- Validators: `scripts/ai-validation/geneformer-parity.py`, `scripts/validate-*-runtime.mjs`.
- Docs: `project-knowledge-base/roadmap/runtime-box-*.md`, `project-knowledge-base/current-project-status.md`.

## Verification

- **Phase 0:** local relocation POC — cold `import torch, ...` from a moved prefix passes;
  activation requirement determined.
- **Cheap gates (every change):** `npm run runtime-box:ci -- check`, focused unit tests,
  `npm run test:verify`, Rust `cargo test runtime_box`, signer policy tests, project-knowledge-base build,
  `git diff --check` (get exact scripts from `package.json`).
- **Per target:** one self-hosted native validation run (build → self-test → scientific parity →
  Rust lifecycle → evidence) then one protected release (KMS sign → R2 publish → beta → product
  install/inference → Jobs/Results/provenance → rollback → cleanup).
- **End-to-end per OS:** install → real inference → Jobs → Results → provenance →
  replacement/rollback/removal → cleanup, on macOS/Linux/Windows.

## Risks / open items

1. **Phase 0 relocation/activation outcome** — biggest unknown; gates the Rust design.
2. **torch 2.8.0 code compat** — UCE most at risk; verify locally before any run.
3. **Scientific numbers shift** on the new torch → re-baseline fixtures/tolerances (accepted).
4. **conda license-audit rework** — audit source changes from `.dist-info` to conda metadata.
5. **bioconda channel** must be added (celltypist and future bio tools).
6. **Self-hosted runner security** — ephemeral single-use + dedicated root mitigate.
7. **Disk footprint** — conda envs may be larger than the uv trees; revisit `diskPlan` floors.
8. **PyPI escape hatch** — not needed for the current 3 (all pure conda-forge-coverable);
   reserved for TensorFlow-on-Windows and un-vendored PyPI-only model packages (future).
