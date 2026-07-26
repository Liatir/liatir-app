# Runtime Box CI migration → pixi + pixi-pack + conda-forge (self-hosted GHA)

Last reviewed: 2026-07-24

Status: **Phases 0–4 DONE; Phase 5 in progress.** scGPT is validated in CI on **every non-macOS
target** — Linux CPU + Windows CPU (build + scientific + native-lifecycle) and Linux CUDA 12.9 +
Windows CUDA 12.8 (scientific, real RTX 4060 Ti); the macOS box is the published pilot and the
launcher re-check is done. Remaining Phase 5: migrate Geneformer and UCE, then the protected
releases. Nothing signed/published/promoted on the pixi substrate yet.

- **Phase 0 — complete on every OS** (macOS Metal + Windows CPU/CUDA + Linux CPU/CUDA). The
  zero-cost local spike is decisive on macOS, on the harder no-rpath Windows case (CPU + CUDA, real
  RTX 4060 Ti compute), and on linux-64 (CPU + CUDA, same GPU via WSL2) — see
  [Phase 0 decision record](./runtime-box-pixi-phase0-spike.md). **No activation env is required on
  any OS.** Note the **per-OS** CUDA pin corrections below: win-64 → 12.8, linux-64 → 12.9.
- **Phase 1 — complete on the scGPT macOS pilot.** That recipe is now pure pixi (`pixi.toml` +
  `pixi.lock` + `recipe.json`, no uv artifacts) with a lock-derived conda license audit, and a real
  end-to-end build produced a signed box whose self-test passed on torch 2.8.0. The uv build path
  is deliberately retained for the seven recipes not yet migrated (Geneformer ×5, scGPT Linux, UCE
  macOS); deleting it is a cleanup for after the Phase 5 rebuilds.
- **Phase 2 — complete, and it needed no Rust change at all.** Provenance is opaque in
  `runtime_boxes.rs`, so the `uvVersion`→`pixiVersion` switch was TypeScript-only; and the box
  ships with no relocation step because running `conda-unpack` is actively harmful.
- **Phase 3 — complete for Linux and Windows.** Cross-OS ephemeral launcher (macOS + Linux/WSL),
  Windows PowerShell launcher, four self-hosted runner profiles, every Linux/Windows model target
  repointed, and the paid `liatir-linux-t4`/`liatir-windows-t4` profiles deleted. All four
  self-hosted preflights pass against the real GitHub API. Coordination jobs stay on cheap hosted
  runners by design. **No runner has been registered and no job has run yet** — the first dispatch
  is the maintainer's call, and the CUDA targets are gated on Phase 4. The shared launcher still
  needs a `--preflight-only` re-check on macOS before the next macOS job.
- **Phase 4 — complete, and now proven on real hardware.** GPU runner profiles declare
  capability/VRAM **floors** instead of one exact card; the parity validator, host probe, evidence
  record and CUDA E2E no longer pin a Tesla T4. The scGPT Linux CUDA run below is the first CUDA
  validation ever executed on the local RTX 4060 Ti (compute 8.9), confirming the generalization
  end to end.
- **Phase 5 — in progress; scGPT is now validated on every non-macOS target.** Linux CPU + Windows
  CPU at every mode (build + scientific + native-lifecycle); **Linux CUDA 12.9 and Windows CUDA 12.8
  scientifically validated on the RTX 4060 Ti** (run `30143289750`, CPU-vs-CUDA parity cosine
  0.9999999999999, box installed 6.58 GB / archive 4.08 GB — far smaller than Linux CUDA because
  Windows conda envs have no symlinks to dereference). Windows CUDA passed on the first dispatch by
  applying the Linux CUDA lessons up front. Geneformer and UCE are not yet migrated. Nothing
  signed/published/promoted.

**Production code HAS changed** as of Phase 1/2 (`packages/liatir-core`, `scripts/runtime-box*`,
`runtime-boxes/catalog.json`, unit tests). Each remaining phase begins only on explicit maintainer
go-ahead, one at a time.

Related plans: [Runtime Box model platform expansion](./runtime-box-model-platform-expansion.md)
(the model/target re-validation this migration feeds into),
[Runtime Box CI foundation](./runtime-box-ci-foundation.md) (the historical uv-based
foundation being replaced), and [Runtime Box production report](./runtime-box-production-report.md)
(the trust/distribution spine that stays unchanged). The remaining recipe migration
and builder retirement now execute through
[Scrollcase P5 — Liatir adoption](./scrollcase-p5-liatir-adoption.md); that plan is
canonical for package adoption, contract inversion, the three uv foundation fixtures,
and preservation of the published Geneformer CUDA 12.4 identity.

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

> **DONE 2026-07-24 for Linux and Windows.** Launchers, runner profiles, target repointing and the
> retirement of the paid native runners are complete and verified by execution; every self-hosted
> preflight passes against the real GitHub API. What remains is a first real dispatch (maintainer's
> call, gated on Phase 4 for the CUDA targets) and a macOS re-check of the shared launcher.
>
> - **Cross-OS launcher (done).** `scripts/run-runtime-box-macos-heavy-runner.sh` is replaced by
>   `scripts/run-runtime-box-selfhosted-runner.sh`, which covers **macOS arm64 and Linux x86_64
>   (including WSL2)** and takes `--model`/`--target`/`--mode` instead of hardcoding UCE. The Gate 9
>   contract is preserved exactly: absolute root outside the checkout, no symlinked root, marker
>   file gating cleanup, catalog-driven bootstrap disk floor, refusal of concurrent registration of
>   the label, pinned runner release verified by SHA-256, `--ephemeral --disableupdate
>   --no-default-labels`, 190-minute online cap, deregistration + diagnostics retention + full root
>   removal on success, failure, or interruption. Runner **2.336.0** is pinned per OS with its own
>   reviewed digest (osx-arm64 unchanged; linux-x64 `04cf0be1…`; win-x64 `d59123a4…`, all read from
>   the release and cross-checked against the digest already committed for macOS).
>   Two Linux/WSL-specific guards were added: the runner root is **rejected under `/mnt/`** (the 9p
>   Windows mount is far too slow for a multi-gigabyte conda prefix, the Phase 0 lesson), and a
>   missing **libicu** is reported up front instead of failing opaquely inside `config.sh`.
> - **Windows launcher (done).** `scripts/run-runtime-box-selfhosted-runner.ps1`, same contract,
>   Windows PowerShell 5.1-compatible, cleanup in a `finally` block. Parse-checked with zero errors;
>   the POSIX one passes `bash -n`.
> - **Runner profiles (done).** `runtime-boxes/catalog.json` gains `linux-x64-selfhosted`,
>   `linux-x64-cuda-selfhosted`, `windows-x64-selfhosted` and `windows-x64-cuda-selfhosted`, each
>   repository-scoped, ephemeral, single-concurrency, clean-work-directory, with a `liatir-…-`
>   name prefix that `validateRunnerExecutionContext` already enforces. The two CUDA profiles
>   describe the **local RTX 4060 Ti** (compute 8.9, ≥8 GB VRAM) rather than the hosted Tesla T4.
> - **Paid native runners retired (done).** Every Linux and Windows **model target** now resolves to
>   a self-hosted profile: Geneformer linux CPU/CUDA and windows CPU/CUDA, and scGPT linux CPU. The
>   `linux-x64-t4` and `windows-x64-t4` profiles are **deleted** — no paid GPU runner remains
>   reachable from the catalog. The two CUDA-preflight workflows and the (dispatch-only) Windows
>   product smoke were repointed to the self-hosted labels as well. A regression test now fails if
>   any non-macOS model target drifts back onto `ubuntu-24.04`, `windows-2025` or either T4 label.
> - **What deliberately stays on paid hosted runners:** the **coordination** jobs — `resolve` in
>   `_runtime-box-validate.yml`, `release-resolve` in `runtime-box-release.yml`, the resolve halves
>   of both CUDA preflights, the foundation workflow, and the signer deploy. These must run when no
>   self-hosted runner is online: the resolve job is precisely what tells the operator **which**
>   runner to bring up, so putting it behind a self-hosted runner would deadlock. They are cheap
>   standard runners, not GPU ones.
> - **Operational consequence to expect:** a native job now **queues until the operator launches the
>   matching runner**. That is the established Gate 9 on-demand model (UCE macOS heavy already works
>   this way), not a regression — but a push touching e.g. the Geneformer paths will sit pending
>   rather than starting on a hosted runner.
> - **The `minimumBootstrapFreeDiskBytes` floors (40 GiB CPU, 64 GiB CUDA) are provisional** and must
>   be re-derived from the measured `diskPlan` when the first Linux/Windows pixi box is built —
>   remember the dereferenced Linux CUDA prefix is ≈9.5 GB before inflation. They currently clear
>   every repointed target's `requiredBuildDiskBytes` (6 GiB CPU, 20 GiB CUDA) with margin.
> - **Launcher behaviour verified by execution (2026-07-24), not by reading.** Every refusal path
>   was exercised on both hosts and each one failed for the right reason, creating nothing:
>   foreign-OS target (`Target runner is macos/aarch64 but this host is …`), target still on a paid
>   runner (`not self-hosted`), runner root inside the checkout, relative runner root, and — Linux
>   only — a root under `/mnt`. The **positive** path was then proven on Windows against the real
>   GitHub API with a temporary, reverted catalog repoint: `Self-hosted runner preflight passed for
>   liatir-windows-selfhosted with 287,353,413,632 free bytes`, exit 0, no runner root created.
>   Two defects were found this way and fixed:
>   - **Cross-OS guard was missing.** Generalizing the launcher made it possible to launch a macOS
>     target from Linux, which would have brought a Linux runner online under the macOS label. The
>     `resolve` output now emits `runner_platform`/`runner_arch` and both launchers refuse a
>     mismatch before touching anything.
>   - **The PowerShell launcher's `gh --jq` filters were broken.** Windows PowerShell drops the
>     quotes around a jq string literal when passing arguments to a native executable, so jq parsed
>     the label as an expression (`function not defined: selfhosted/0`). Both call sites now fetch
>     the runner inventory and match in PowerShell instead.
> - **All four self-hosted preflights pass green against the real GitHub API** (2026-07-24), on the
>   final repointed catalog, each registering nothing and creating no runner root:
>   `liatir-linux-selfhosted` and `liatir-linux-cuda-selfhosted` from WSL (1,023,365,287,936 free
>   bytes), `liatir-windows-selfhosted` and `liatir-windows-cuda-selfhosted` from Windows
>   (≈287.35 GB free). Each exercises the whole chain: catalog resolve → self-hosted → host/target
>   match → disk floor → `gh` auth → repository runner inventory.
> - **Still not proven end-to-end:** no runner has been **registered** and no job has been
>   executed. The remaining step is a real dispatch, which is the maintainer's call and needs the
>   matching runner brought online at the same time.
> - **Windows CUDA is reachable again.** Repointing removed the old hosted-driver blocker, and the
>   Tesla-T4 pin that would have rejected the RTX 4060 Ti was removed by Phase 4 below. Both CUDA
>   targets are now dispatchable in principle; neither has been dispatched.
> - **Host prerequisites established on the maintainer's box:** Node 22.14.0 installed system-wide
>   in WSL (`/usr/local/bin/node`, matching the workflows' pinned Node 22 and the Windows host) and
>   `gh` 2.46.0 via apt. The Windows host has `gh` 2.96.0 at `C:\Program Files\GitHub CLI`,
>   authenticated with `repo` + `workflow` scopes.
>
> **Windows portability defects found and fixed while running the gates (pre-existing, not
> introduced by this phase).** The unit suite could not run at all on a Windows checkout because
> `* text=auto` gives CRLF working-tree files:
>
> 1. **vite-node cannot transform a shebang followed by CRLF** → every `scripts/*.mjs` with a
>    shebang failed to import, taking 7 test files down with `SyntaxError: Invalid or unexpected
>    token` and no file name. Isolated to that exact combination (shebang alone fine, CRLF alone
>    fine).
> 2. **The CI guard tests anchor on `"\n  <job>:\n"`**, which CRLF turns into a silent no-match;
>    `slice(-1)` then made two workflow assertions vacuous rather than failing loudly.
> 3. **`runtime-box-cost-controls`** built an expected npm path as a POSIX string while
>    `npmInvocation` uses `path.resolve`, which is drive-qualified on Windows.
> 4. **The SDK type generator produced host-dependent artifacts** — the worst of the four, because
>    it corrupts a **committed generated product file** rather than a test. `gen:sdk-types` lifts
>    JSDoc text into string literals in `liatir-completions.generated.ts` /
>    `liatir-sdk-types.ts`; on Windows that text arrives CRLF and gets baked in as literal `\r\n`.
>    Running the build on a Windows runner would therefore have produced a spurious diff in
>    generated output on every run. Normalized at both entry points (the source read, and `getDoc`,
>    where the TypeScript host reads files itself). Verified: regenerating on Windows now yields
>    artifacts **byte-identical to `main`**.
>
> Fixes: pin `*.sh`, `*.mjs`, `*.yml`, `*.yaml` to `eol=lf` in `.gitattributes` (69 working-tree
> files renormalized, **zero content diffs**), build the expected path with the same resolver, and
> normalize line endings in the SDK generator.
> Result on Windows: unit suite **172/172, 29/29 files** (was 110 passing with 7 files unloadable),
> `verify` profile 6/6, catalog check, `lint:ts` 0 errors, knowledge-base build — all green.

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

> **DONE 2026-07-24.** The CUDA path no longer pins one exact card anywhere. A GPU runner profile
> now declares **floors** — `minimumComputeCapability` + `minimumGpuMemoryBytes` — and the old
> `expectedGpuModel` / `expectedComputeCapability` fields are gone, with catalog validation
> actively rejecting their reintroduction.
>
> - **Floors chosen from evidence, not habit.** `minimumComputeCapability` is **7.5** — the
>   capability the scientific tolerances were established on, which the RTX 4060 Ti (8.9) clears.
>   `minimumGpuMemoryBytes` is **7.5 GB**, replacing the old 15 GB T4 figure that had no scientific
>   basis: reviewed run `29750614689` records a measured **peak VRAM of 106,767,872 bytes (~102 MiB)**
>   for this model. The floor is therefore ~70× the measured need, sized to admit an 8 GB-class card
>   and reject a 4 GB one, not to describe the model's appetite.
> - **`probeHost`** compares component-wise (`numericVersionAtLeast`) instead of by equality, so 8.9
>   satisfies a 7.5 floor. The exact model is **recorded as evidence, asserted only to be present**.
> - **`scripts/ai-validation/geneformer-parity.py`** lost `EXPECTED_T4_MODEL`,
>   `EXPECTED_T4_CAPABILITY` and `MINIMUM_T4_MEMORY_BYTES`. It takes `--min-compute-capability` and
>   `--min-gpu-memory-bytes`, **passed from the catalog runner profile** by
>   `validate-geneformer-parity.mjs`, so the host probe and the scientific validator enforce one
>   contract from one source. Scientific tolerances are untouched (cosine ≥ 0.99999, abs 1e-5,
>   rel 1e-4). The torch-vs-nvidia-smi agreement check is kept — a mismatch means the process is not
>   looking at the probed GPU — but it now compares the two readings against each other rather than
>   against a fixed name.
> - **Evidence stops carrying a fabricated identity.** The record used to stamp `"Tesla T4"` and
>   `"7.5"` regardless of the hardware; it now carries the detected model and capability, and the
>   product-runner cross-check compares against those detected values.
> - **One more hard T4 pin was found and removed outside the planned scope:**
>   `tests/e2e/specs/runtime-box-native.e2e.mjs` asserted `gpuModel: 'Tesla T4'` and
>   `computeCapability: '7.5'` in the CUDA product-lifecycle E2E. That would have failed on the
>   4060 Ti after everything else was generalized. It now asserts shape and presence.
> - **Not changed, as planned:** the scGPT and UCE validators were already hardware-agnostic.
>
> Gates: unit **175/175** across 29 files (including a new test asserting that both 7.5 and 8.9
> clear the floor while 6.1 does not), catalog check, `verify` 6/6, `lint:ts` 0 errors,
> `py_compile`, knowledge-base build. **Phase 4 unblocks CUDA dispatch on the local GPU**; it has
> not been exercised on real hardware yet, because that is a Phase 5 run.

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

> **In progress (2026-07-24) — scGPT Linux CPU and Windows CPU migrated to the pixi substrate,
> local work only. Nothing has been signed, published or promoted.**
>
> - **scGPT `linux-x86_64-cpu` migrated off uv.** `requirements.in`/`requirements.lock` deleted;
>   `pixi.toml` + committed `pixi.lock` added. The lock reproduces the Phase 0 Linux spike exactly:
>   `pytorch 2.8.0 cpu_mkl_py311_hcfbaf12_102`, python 3.11.15, numpy 2.4.6, anndata 0.12.19.
>   Lock sha256 `fb7aeff5b95faeda3277f4ba2216ac269db6f0d263c0ccf07779452b55f0dec1`;
>   lock-derived conda licence audit of **112 packages, all licensed**.
> - **scGPT `windows-x86_64-cpu` added as a new target** — there was no uv-era Windows scGPT recipe
>   to migrate, so this closes a real support gap rather than porting one. Resolves to
>   `pytorch 2.8.0 cpu_mkl_py311_h64e3758_102` at the same python/numpy/anndata versions as Linux.
>   Lock sha256 `223f3996e052be616e6f481e1fa65db376c0da2fa555b7425bc73fa2896682c8`; audit of
>   **94 packages, all licensed**. `pythonEntryPoint` is `venv/python.exe` (conda puts the
>   interpreter at the prefix root on Windows). Wired into the catalog, the signer policy, and the
>   scGPT workflow's `target_id` options and path filters.
> - **Both locks were produced from the Windows host.** `pixi lock` resolves for the manifest's
>   declared `platforms`, so a linux-64 lock is host-independent — no Linux machine was needed to
>   generate it, and the result matches what the Phase 0 spike solved natively on WSL.
> - **`diskPlan` floors set from measurement, not estimate.** Measured by installing each committed
>   lock with `--frozen` and packing it:
>
>   | Target | venv installed | dereferenced payload | conda-pack `tar.gz` |
>   | --- | --- | --- | --- |
>   | linux-64 CPU | 1,654,241,925 B (1469 symlinks) | **2,790,991,054 B** | 527,585,007 B |
>   | win-64 CPU | **1,407,747,346 B** (no symlinks) | same as installed | 421,401,332 B |
>
>   Linux inflates **1.69×** when symlinks are dereferenced, which is the size the box actually
>   ships; Windows has no symlinks so its installed size is already the shipped size.
> - **The Windows box was built and independently verified locally (2026-07-24).** A full
>   `build` produced a dev-signed box — `pixi install --frozen` → conda-pack → `venv/` → asset
>   download → self-test → deterministic ZIP → signed release + channel — and
>   `verify --self-test` then re-extracted the signed archive, re-checked signature and hash, and
>   **passed the self-test inside the extracted box**, including loading the 205 MB `best_model.pt`
>   and asserting the `(60697, 512)` / `(1536, 512)` tensor shapes on torch 2.8.0. Measured:
>   payload **1,617,324,801 B**, archive **568,684,158 B** — both comfortably under the declared
>   `diskPlan`, which is therefore validated as conservative rather than guessed. The Linux archive
>   estimate was raised to 1.25 GiB from the measured Windows archive/payload ratio (0.35).
> - **This closes a Phase 2 open question.** That record noted `venv_python_for` "needs no change …
>   to be re-confirmed when the first Windows pixi box is built". It is now confirmed: the Rust
>   resolver's existing probe found the conda interpreter at `venv/python.exe`, and the self-test
>   ran with no injected environment, exactly as Phase 0 predicted for win-64.
> - **scGPT Linux CPU validated natively on the self-hosted runner (2026-07-24) — the first pixi
>   box built and scientifically validated in CI.** Dispatched `runtime-box-scgpt-whole-human`
>   (mode `scientific`) at commit `70912e3`; the reusable validation workflow's `native` job ran on
>   an ephemeral WSL runner (`liatir-linux-selfhosted-1784934442-565`, `RUNNER_ENVIRONMENT=self-hosted`)
>   in ~9.5 min and **passed**. Run `30132956412`. Evidence (`status: passed`): pixi 0.73.0,
>   python 3.11.15, lock sha `fb7aeff…` matching the committed one, self-test passed (all imports +
>   local signature), and scientific validation on **torch 2.8.0 CPU** producing a finite `[1, 512]`
>   embedding with the output and provenance contracts passing and CPU-baseline parity `passed`.
>   Measured on the runner: installed **3.55 GB**, archive **1.21 GB** — within the `diskPlan`
>   floors set from the local measurement, confirming them against a real CI build. The runner
>   deregistered and its work root was removed; the repository runner inventory is empty. The
>   catalog target advances **`buildable` → `scientifically-validated`**. Still open for this
>   target: `native-lifecycle` mode (needs the Tauri deps, which want passwordless sudo in WSL) and
>   the protected release (KMS sign + R2 publish + beta), which is intentionally deferred.
> - **scGPT Windows CPU validated natively on the self-hosted Windows runner (2026-07-24).** Same
>   flow (mode `scientific`) at commit `bf58566`, on the maintainer's Windows box as an ephemeral
>   `liatir-windows-selfhosted` runner. Run `30134159371`, **passed**: pixi 0.73.0, python 3.11.15,
>   lock `223f3996…`, self-test passed, scientific validation on torch 2.8.0 CPU with a finite
>   `[1, 512]` embedding and output/provenance contracts passing. Measured installed **1.39 GB**,
>   archive **0.53 GB** — matching the local Windows build. Target advances to
>   `scientifically-validated`. The first attempt (`30133946752`) failed only because the CI pixi
>   step used `shell: pwsh`, which the self-hosted Windows box lacks; fixed to `shell: powershell`
>   (commit `bf58566`), and everything before that step had already passed.
> - **scGPT Linux CUDA 12.9 validated on the RTX 4060 Ti (2026-07-25) — the first CUDA box on the
>   pixi substrate and the first CUDA validation on the local GPU.** Run `30141976372` (mode
>   `scientific`) passed on `liatir-linux-cuda-selfhosted`: pixi 0.73.0, `pytorch 2.8.0 cuda129`,
>   accelerator **CUDA**, GPU `NVIDIA GeForce RTX 4060 Ti` (compute 8.9) matching the host, peak
>   VRAM 219,378,688 B (~209 MiB), and **CPU-vs-CUDA parity passed** (cosine 0.99999999999994, max
>   abs diff 8.9e-8). Target advances to `scientifically-validated`.
>   - **Real footprint (the largest box in the matrix by far):** installed **25.8 GB**, archive
>     **15.9 GB**. Phase 0's ~9.5 GB was the symlinked prefix; dereferencing the CUDA env inflates
>     it ~2.7×. The `diskPlan` was corrected to these measured values (required build disk 56 GiB,
>     under the 64 GiB CUDA runner floor). A ~16 GB user download is a real product consideration.
>   - **It took five dispatches, each a distinct defect in the new CUDA path or the WSL host, never
>     the box or the CUDA compute** (which worked from the 4th run): (1) the self-test was cloned
>     from the CPU recipe and asserted CUDA *absent*; (2) `verify` extracted the ~16 GB box into
>     WSL's 8 GB `/tmp` tmpfs (ENOSPC) → TMPDIR pointed at the work volume; (3) the 205 MB checkpoint
>     download dropped mid-stream (undici `terminated`) → bounded retry with resume; (4) the scGPT
>     validator left `accelerator.gpuModel`/`gpuMemoryBytes` null, which the evidence contract
>     requires for CUDA → the product runner now reports GPU identity. Each fix is permanent and
>     benefits future targets.
> - **This also proved the CI pixi provisioning added to `_runtime-box-validate.yml`** (pinned pixi
>   and conda-pack, with uv made conditional) on Linux CPU, Windows CPU **and Linux CUDA** runners.
> - **native-lifecycle validated on Linux (2026-07-24).** Run `30135717742` (mode
>   `native-lifecycle`) passed on the WSL runner: it installed the Tauri system libraries, built the
>   `src-tauri` bridge with Rust 1.95, and ran the `cargo test runtime_box` lifecycle suite against
>   the pixi box. This required passwordless `apt-get` on the WSL host — configured as a scoped
>   `/etc/sudoers.d/liatir-runner` (`NOPASSWD: /usr/bin/apt-get`, validated with visudo), the
>   durable alternative to storing a password. **scGPT Linux CPU advances to
>   `native-lifecycle-validated`.**
> - **native-lifecycle validated on Windows (2026-07-24).** Run `30136322406` passed on the Windows
>   self-hosted runner: MSVC Rust/Tauri compile + `cargo test runtime_box` against the pixi box,
>   self-test passed, scientific parity `[1, 512]` on torch 2.8.0 CPU. **scGPT Windows CPU advances
>   to `native-lifecycle-validated`.** No sudo needed on Windows — the VC++ tools were already
>   present. **Both scGPT CPU targets are now fully validated in CI at every mode** (build +
>   scientific + native-lifecycle).
> - **macOS launcher re-check DONE (2026-07-25, local zero-cost on the maintainer's Apple-Silicon
>   Mac).** Phase 3 deleted the macOS-only launcher; this proved the shared launcher's Darwin branch
>   on a real Mac. **Part A (required):** `npm run runtime-box:runner:macos-heavy -- --runner-root
>   "$HOME/liatir-runner" --preflight-only` printed `Self-hosted runner preflight passed for
>   liatir-macos-arm64-heavy with 45410160640 free bytes` (≈45.4 GB, over the 35 GiB floor), exit 0,
>   created no runner root, and left the repository runner inventory empty — exercising the
>   `Darwin:arm64` host detection, the `shasum -a 256` tooling (vs Linux `sha256sum`), catalog
>   resolve, host/target-OS guard, disk floor, and the concurrent-registration refusal. Host: Node
>   26.4.0, `gh` authenticated with `repo` scope. **Part B (optional, run):** contained pixi 0.73.0 +
>   conda-pack 0.9.2 under `~/.local/liatir-pixi` (no system changes) built and dev-signed the scGPT
>   `0.2.5-beta.1` macos-aarch64-metal box on the pixi substrate (`Signed release:` / `Signed
>   channel:`, exit 0), and `verify --self-test` passed (`Verified scgpt-whole-human 0.2.5-beta.1
>   (macos-aarch64-metal)`), loading `best_model.pt` and asserting tensor shapes on torch 2.8.0
>   Metal. **Measured archive 655,752,216 B (≈0.61 GB)**; `.runtime-box-build/` and
>   `.runtime-box-dist/` were deleted afterwards. No production code changed and nothing was signed
>   for release, published, or promoted. Once the maintainer gives the go-ahead (and after a prior
>   `runtime-box:signer:deploy`), only the protected release (KMS sign + R2 publish + beta) is left.
> - **Known conservatism:** the migrated recipes carry only the *source* prune list — the conda
>   `venv/` prunes from the macOS pilot (torch/include, sympy, networkx, stdlib extras) were not
>   ported, because their exact `dist-info` directory names are lock-specific. The boxes are
>   therefore larger than necessary and the `diskPlan` figures above are upper bounds. Worth
>   closing, but it is a size optimisation, not a correctness issue.
> - **Blocking prerequisite before any protected release, newly diagnosed:** the previous scGPT
>   Linux release failed because the **deployed** signer served an older policy. `policy.json` now
>   lists all three scGPT targets, but committing it does not deploy it — `runtime-box:signer:deploy`
>   must run first. See the model-platform-expansion plan for the full diagnosis.

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
