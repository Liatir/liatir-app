# Current project status

Last updated: 2026-07-24 (a full CI substrate migration to pixi + pixi-pack +
conda-forge on self-hosted GitHub Actions runners has been planned and approved
in principle — see the migration plan below. Its **Phase 0 relocation/activation
spike is now complete and decisive on ALL THREE OSes: macOS Metal, Windows
(CPU + CUDA) and Linux (CPU + CUDA)**: conda-pack is the chosen relocation
mechanism and **no activation environment is required on any OS** — a relocated
conda-forge prefix imports the whole scGPT set cold and runs accelerator compute
(Metal on macOS, a real CUDA matmul on the RTX 4060 Ti on both Windows and Linux)
under a fully empty environment, so the Rust self-test/run path stays
activation-free everywhere and the manifest `activation` field stays `null` for
every target. Two recipe corrections, and the CUDA pin is **per-OS**: conda-forge's
CUDA `pytorch 2.8.0` is **cuda128** for win-64 but **cuda129** for linux-64, so
Windows CUDA pins **12.8** and Linux CUDA pins **12.9** (neither has a 12.4 build,
and 12.8 does not solve at all on linux-64). See
[Phase 0 decision record](./roadmap/runtime-box-pixi-phase0-spike.md).
**Phases 1 and 2 of that migration are also complete**: the scGPT macOS pilot is a
pure pixi recipe that builds end-to-end into a signed box whose self-test passes on
torch 2.8.0, and the Rust layer needed no change at all. **Phase 3 is complete for
Linux and Windows**: a cross-OS ephemeral runner launcher (macOS + Linux/WSL) plus a
Windows PowerShell counterpart, four self-hosted runner profiles, every Linux and
Windows model target repointed onto them, and the paid `liatir-linux-t4` /
`liatir-windows-t4` profiles deleted. All four self-hosted preflights pass against
the real GitHub API; only coordination jobs stay on cheap hosted runners, by design,
because the resolve job is what tells the operator which runner to start. **No runner
has been registered and no job has run yet**, and native jobs now queue until the
operator brings the matching runner online — the established Gate 9 on-demand model.
**Phase 4 is now a hard prerequisite for any CUDA dispatch**: the parity validator
still asserts a Tesla T4 and rejects the RTX 4060 Ti. Phase 5 has not started.
Production code has therefore already changed under this migration. Runtime Box CI foundation Gates 0–10 are
complete; the product AI Model catalog has been cut over to Runtime Box-only
delivery).

This file is the quick handoff snapshot. The canonical detailed plans are:

- [Scientific AI Workbench product plan](./roadmap/scientific-ai-workbench.md) —
  the overall product direction and phase gates.
- [Runtime Box cross-platform CI foundation](./roadmap/runtime-box-ci-foundation.md) —
  the completed foundation gate ledger. Read it before touching Runtime Box CI;
  it holds the authoritative status table, execution records, and incident
  ledger.
- [Runtime Box production report](./roadmap/runtime-box-production-report.md) —
  the current support matrix, production topology, reviewed evidence, protected
  identities, and operator handoff.
- [Runtime Box model platform expansion](./roadmap/runtime-box-model-platform-expansion.md) —
  the active execution plan to bring scGPT and UCE to Linux CPU/CUDA and
  Windows CPU; its P0 local portability correction is complete and P1 Linux
  CPU has complete corrected native lifecycle evidence; its first protected
  release stopped at the KMS-backed build before publication.
- [Runtime Box pixi migration](./roadmap/runtime-box-pixi-migration.md) — the
  approved-in-principle plan to replace the uv/python-build-standalone builder
  with pixi + pixi-pack + conda-forge (Variant A + a contained PyPI escape
  hatch) on self-hosted GitHub Actions runners, standardize torch on 2.8.0, and
  re-validate every box. **Phases 0, 1 and 2 complete** (Phase 0 on every OS;
  Phase 1 on the scGPT macOS pilot, with the uv path retained for the seven
  unmigrated recipes; Phase 2 with no Rust change needed). **Phase 3 —
  self-hosted ephemeral CI — is next; Phases 4–5 not started.**
- [Runtime Box pixi Phase 0 spike](./roadmap/runtime-box-pixi-phase0-spike.md) —
  the decisive local relocation/activation decision record: conda-pack, **no
  activation env on any OS (macOS, Windows and Linux, CPU + CUDA)**, `venv/`
  box layout, footprints ≈833 MB (macOS) / ≈1.35 GB (win CPU) / ≈6.5 GB (win CUDA)
  / ≈1.63 GB (linux CPU) / **≈9.5 GB (linux CUDA, the largest box in the matrix)**,
  CUDA pinned per-OS at 12.8 (win-64) and 12.9 (linux-64). The Linux CUDA proof ran
  under WSL2's driver bridge, so it is strong evidence rather than bare metal;
  cuDNN/cuBLAS/libtorch_cuda were all verified to load from the relocated prefix.

## Where the project is

Phase 1 of the Scientific AI Workbench plan is complete: the Runtime Box CI
foundation has closed Gates 0 through 10. Product-level Runtime Box work now
has two explicit tracks: cross-version update with client-persisted anti-replay
state, and cross-platform expansion of the current model catalog before new
model families are admitted. The common execution spine follows in Phase 2.
The cross-platform track now has a canonical target-by-target execution plan.
The new scGPT Linux CPU target is checked and deliberately remains `buildable`.
Run `29951014606` exposed and closed a dependency-audit/pruning contradiction.
Run `29951632568` then passed build, self-test, and real finite 512-dimensional
CPU inference, but exposed a shared validation-workflow omission of the Linux
Tauri system libraries at the Rust lifecycle stage. Run `29952407546` proved
that shared fix by compiling Tauri and again passing the native build and
scientific chain, then exposed nondeterministic rollback pruning when Linux
filesystem timestamps tied. The product fix now preserves the exact backup
created by the current activation; its direct regression, all 11 Runtime Box
Rust tests, catalog/signer/docs, and the complete 157-test verify chain pass
locally. Validation run `29954604079` then passed the complete corrected Linux
lifecycle, including a second real finite `1 x 512` CPU inference and every
Runtime Box Rust test; artifact `8543832402` was reviewed.
Protected release `29955615971` passed input resolution, host capacity, OIDC,
toolchain, and the clean-revision boundary, but failed in the private-KMS
signing build before scientific validation, R2 publication, product lifecycle,
or beta promotion. Cleanup passed. The exact remote error still needs retrieval
before diagnosis because the active Codex usage limit blocked log access. The
target remains `buildable`, unpublished, unpromoted, and unsupported.

**Runtime Box-only product cutover (2026-07-22):** the AI Model catalog now
contains exactly Geneformer V1 10M, scGPT Whole-human, and UCE 4-layer. Every
entry is installed only from a signed, published Runtime Box. The former
`builtin`, `managed-download`, and locally built `managed-runtime` AI Model
paths, their preloaders, the mock model/tool, and model-specific Tools for the
removed experimental models have been deleted. The remaining product AI Tool
is Single-cell Embedding, shared by all three published models. Generic managed
binary and Python-environment infrastructure remains only where it is still
used by Native Tools, viewers, Plugins, or Runtime Box execution.

**Cross-platform product policy (2026-07-22):** every AI Model must ultimately
ship on every native product target where its license, framework, and hardware
requirements make execution reasonably possible. A missing recipe or unstarted
validation is support debt, not an exception. Genuine exceptions require an
evidenced upstream or infrastructure blocker and honest compatibility messaging.
Under this rule Geneformer has completed the current macOS Metal, Linux
CPU/CUDA, and Windows CPU matrix; scGPT and UCE are useful pre-release catalog
entries but are not cross-platform complete. Their Linux CPU/CUDA and Windows
CPU Runtime Boxes must be built, published, and product-validated. Windows CUDA
remains a shared infrastructure blocker under the existing no-dispatch decision,
not a claim that the models themselves can never support it.

**CPU support gating (2026-07-23):** CPU support for an AI Model is not
mandatory. Target users are non-technical analysts working on adequate hardware;
adapting a model to inadequate hardware is out of scope, and every supported Mac
has Metal. A CPU Runtime Box is shipped only when the model completes a
realistic reference dataset within an acceptable wall-clock threshold. When CPU
execution would take hours, or is otherwise too slow to be useful, the CPU box
is not shipped for that model and the product states honestly that the model
requires GPU or Metal. This decision is made per model from a measured amortized
throughput, not from the binary fact that inference runs at all. Geneformer V1
10M remains CPU-supported because it is trivially fast on CPU. This refines the
"reasonably possible" clause above: a technically working but hours-slow CPU box
is a false promise for non-technical users, so it does not count as reasonable
support. The scGPT and UCE CPU targets are therefore gated on a local,
zero-cost CPU-vs-Metal throughput measurement before their CPU boxes are built
or published.

Runtime Box CI foundation gate summary (see the ledger for evidence IDs):

- Gates 0–7 and Gate 8.1 (Geneformer Linux CPU + CUDA pilot): **complete**.
- **Gate 8.2 Windows CPU: complete.** Release run `29706828552` (commit
  `f067482`) passed the full protected release on `windows-x86_64-cpu`: signed
  build, native self-test, scientific validation, immutable publication with
  public hash verification, the complete product lifecycle E2E (install,
  interrupted-download resume, real Geneformer inference with a finite 256-dim
  CPU embedding, Jobs/Results/provenance, replacement, rollback, cleanup), and
  beta promotion. The `beta` channel now serves the Windows CPU box.
- **Linux CUDA re-validated on the current code (2026-07-20).** Release run
  `29750614689` (commit `2307663`) passed the full protected release on
  `linux-x86_64-cuda12.4` on `liatir-linux-t4`: signed build, native self-test,
  T4 scientific validation, immutable publication, complete product lifecycle
  (real Geneformer inference on the T4, Jobs/Results/provenance, replacement,
  rollback, cleanup), and beta promotion. This confirms the shared fixes
  (client-side E2E navigation + reactive finalization `$effect`) do not regress
  Linux, and provides fresh Linux CUDA evidence. One run, ~$1.
- **Gate 8.2 Windows CUDA: implementation retained, but deferred and formally
  out of Gate 8 scope (2026-07-21).** Added `runtime-boxes/recipes/geneformer-v1-10m-windows-x86_64-cuda12.4/`
  (recipe.json + requirements.in + hash-pinned `requirements.lock` cross-resolved
  with uv 0.11.28 for `x86_64-pc-windows-msvc` + `--torch-backend cu124`), the
  reviewed license audit `runtime-boxes/legal/audits/geneformer-v1-10m-windows-x86_64-cuda12.4.json`,
  the catalog target (status `buildable`, runner `windows-x64-t4`,
  `linuxValidationPrerequisiteTargetId: linux-x86_64-cuda12.4`), the signer-policy
  target, and the release-workflow `target_id` option. The Windows cu124 lock is
  the Windows CPU lock with only torch (cpu→cu124), filelock and regex bumped —
  **no triton, no nvidia-\*** (Windows torch bundles the CUDA runtime), so the
  legal notices are unchanged from CPU. Cheap gates all pass: `runtime-box:ci
  check`, target resolve (peak disk ~15 GB < 20 GB required), LF line endings,
  74 runtime-box unit tests, 11 signer-policy tests. These checks establish only
  that the recipe and orchestration are buildable; they do not establish native
  CUDA support, publication, or a pending release entitlement.
  - Two nvidia-smi quirks were fixed at the cheap host-probe (both in
    `evidence.mjs` `gpuIdentity`, commit `a9af8c6`): nvidia-smi not on PATH
    (now probes System32 + the legacy NVSMI folder) and the unsupported
    `compute_cap` query field (now derives compute capability from the known
    Tesla T4 model; torch scientific validation stays authoritative).
  - **DECISION (2026-07-21): Windows CUDA is deliberately excluded from the CI
    until GitHub ships a newer Windows GPU-runner driver.** Hard blocker: the
    GitHub-hosted Windows T4 runner has NVIDIA driver 471.11 (R470), too old for
    CUDA 12.4 (needs R525+ / R551.61). The host-probe correctly rejected it
    (`driver 471.11 is below 551.61`) in ~1 min before any paid build — infra
    limitation, not code. The recipe + wiring are correct and stay committed
    (target status `buildable`, never `published`), so no unvalidated box ships.
    Do NOT dispatch Windows CUDA release runs until the runner has R525+ (or a
    self-hosted one is added), or a separate `windows-x86_64-cuda11.8` target is
    chosen. The maintainer will separately validate Windows CUDA locally later on
    an RTX 4060 Ti (compute 8.9) — which needs the Tesla-T4-pinned validator
    (`scripts/ai-validation/geneformer-parity.py`) generalized first. Gate 8.2 is
    otherwise closed: macOS, Linux CPU/CUDA, Windows CPU are all validated and
    beta-promoted.
- **Gate 8.2 is closed** on every in-scope target (macOS arm64 Metal, Linux CPU,
  Linux CUDA, Windows CPU). Per the 2026-07-21 re-scope recorded in the ledger,
  `windows-x86_64-cuda12.4` is **deferred and out of Gate 8 scope**: it is not a
  supported target and **must not block Gate 8.3, 9 or 10**.
- **Gate 8.3 and Gate 8 are complete** for macOS arm64 Metal, Linux CPU, Linux
  CUDA, and Windows CPU. Validation-only macOS regression run `29880520628` at
  clean remote revision `d07b6b4` passed preflight, native build, self-test,
  4 x 256 Metal scientific parity, Rust lifecycle, compact evidence upload, and
  cleanup. Final artifact `8514665653` has digest
  `sha256:b1b4911121897542bed0961bd0e93ac2ca88c7d17f6229913733a0a062630c74`.
  The run found no shared-builder incompatibility, so the already-live macOS
  box was not republished. The complete evidence audit, reviewed evidence
  import, shared-core/catalog alignment, and honest readiness/support matrix are
  also complete locally. CUDA is supported only on Linux; Windows CUDA remains
  buildable but unvalidated, unpublished, unsupported, and out of Gate 8.
- **Gate 9 macOS heavy runner: complete.** UCE resolves only
  to a checked repository-scoped, ephemeral, single-concurrency
  `liatir-macos-arm64-heavy` profile. The local launcher pins GitHub Actions
  runner `2.336.0`, requires a dedicated root outside the checkout, enforces a
  35 GiB bootstrap floor before any download or registration, installs no
  service, caps online time at 190 minutes, preserves diagnostics, and removes
  the complete marked runner root after success, failure, or interruption.
  Validation verifies the self-hosted execution context and exact `main`; the
  protected release retains OIDC to the private Cloud Run/KMS signer and no
  local signing key.
  - **First release attempt diagnosed; no publication occurred:** after the
    successful `39,284,838,400`-byte preflight and explicit activation approval,
    protected run `29889431937` used exact `main` revision `0c8310f`, resolve job
    `88826727465`, release job `88826776619`, and ephemeral runner
    `liatir-macos-heavy-1784692230-27603`. Host validation, OIDC, setup, exact
    revision, and every UCE asset download passed. The build then failed before
    self-test, signing, scientific validation, publication, or beta promotion:
    extracting the protein-embedding archive deleted sibling assets already in
    its destination, producing a missing-self-test-file error for
    `model-cache/uce/model_files/species_offsets.pkl`.
  - **Evidence and cleanup:** failed evidence artifact `8517777517` is 650 bytes
    with digest
    `sha256:084abf567d2750410e0c105f1b325363d43d9a07195003f5cc372f0b5eacad4a`.
    Workflow cleanup passed, the runner deregistered, the marked work root was
    removed, diagnostics were retained, runner inventory is empty, and the host
    recovered `38,710,562,816` free bytes.
  - **Builder fix:** archive extraction now preserves sibling
    assets and rejects collisions. Both regressions pass; catalog validation is
    green; the full verify profile passes 164/164 tests, SDK/core/Svelte/frontend
    and root builds; and Rust `runtime_box` passes 11 with one established large
    fixture ignored.
  - **Protected closure run:** after the fix was pushed at exact revision
    `8e1251274695b266fb52905e3e2d1a1b40a1b6ee`, freshly approved run
    `29909249357` passed resolve job `88887957863` and release job `88888035723`
    on exact ephemeral runner `liatir-macos-heavy-1784713742-2693`. Build, KMS
    signing, independent native self-test, UCE Metal scientific parity,
    immutable R2 publication with public hash verification, beta promotion,
    evidence upload, and workflow cleanup all passed.
  - **Produced evidence:** reviewed record
    `runtime-boxes/evidence/uce-4layer-macos-aarch64-metal-1.0.0-beta.1-run-29909249357.json`
    pins archive hash `63fc02de8e91699176510051be38790ab69739a92fe32052011081ad8297c960`
    and the KMS key. Artifact `8525984364` has digest
    `sha256:8166557f9953e4713e577558da5fe485d732e57aef299dbb54fb35630842fbaf`.
    The live signed beta channel was independently read and points at the new
    immutable manifest with 100% rollout.
  - **Runner cleanup:** listener exit `0`, local credentials/registration
    removed, diagnostics retained, repository runner inventory zero, marked
    root absent, and `43,393,630,208` free host bytes after cleanup. No heavy
    runner remains online.
- **Gate 10 operational handoff: complete.** The production report now records
  the reviewed run matrix, honest support boundary, protected workflows,
  environments, variable and secret names, WIF principal forms, service
  accounts, signer/Registry resources, commands, cost and authorization
  boundaries, cleanup, token/key rotation, and revocation stop conditions.
  Runtime Box, signer, Registry, compatibility, evidence, AI roadmap, readiness,
  and handoff documentation are aligned. Zero-cost closure gates passed:
  catalog 3 models / 3 fixtures, signer 11/11, verify profile 164/164 plus all
  builds/checks, and the complete project-knowledge-base build. No remote or paid action
  was needed.

## How Gate 8.2 Windows CPU was closed (2026-07-19/20)

The Windows product lifecycle had never run end to end before, so each release
run surfaced the next Windows-only defect. The turning point was capturing the
self-test's stderr, which replaced opaque `exit code 1` failures with real
errors. Seven real causes were fixed (not symptom patches); the two marked
**PRODUCT** would have hit real Windows users, not just the test:

1. `scripts/runtime-box/heartbeat.mjs` spawned `npm` shell-free → ENOENT on
   Windows; now routed through the shared `npmInvocation` (unblocked the free
   foundation Windows validation).
2. **PRODUCT** — staging dir renamed from `.{runtime_id}.{uuid}.staging` to a
   short `.stg-{uuid}`: the long path pushed the box's nested `torch\lib\*.dll`
   past the Windows MAX_PATH (260) the DLL loader enforces (`WinError 206`).
3. **PRODUCT** — `venv_python` now resolves both interpreter layouts: a managed
   venv uses `Scripts\python.exe`, but the standalone box ships `venv\python.exe`
   (Unix layouts coincide on `bin/python`, so only Windows diverged).
4. E2E WebDriver script timeout raised to the app-side 600s Python job limit
   (cold torch/scipy imports exceeded the W3C 30s default).
5. E2E `navigate` uses client-side SvelteKit routing instead of a hard
   `window.location.href` reload, which dropped the WebDriver connection on
   Windows.
6. **PRODUCT** — reactive `$effect` in the root layout finalizes completed
   direct AI runs on any jobs-list change; previously finalization only ran
   while a job was polling or was triggered incidentally by a reload-remount
   (exposed when #5 removed the reload).
7. `rename_with_retry` (bounded backoff on transient Windows sharing/lock
   violations) on the activation, rollback, and download-rename paths; plus the
   diagnostic self-test stderr capture (`run_self_test`).

Commit trail on `main`: `69b7df2`, `657a52b`, `94d93e8`, `c6eba27`, `6534f1b`,
`4f82542`, `3503920`, `f067482`, then `35be12a` (docs). Roughly nine remote
Windows release runs were spent isolating these one at a time, because the
Windows lifecycle E2E cannot be reproduced on the macOS dev host.

## GPU runner facts (established 2026-07-20 — previously undocumented)

The CUDA runner labels `liatir-linux-t4` / `liatir-windows-t4` (catalog
`runnerProfiles`) are **GitHub-managed GPU larger runners**, not self-hosted and
not GCE VMs. Confirmed 2026-07-20: (a) the repo's Self-hosted runners tab is
empty and the maintainer hosts nothing locally; (b) Compute Engine was never
enabled in GCP `liatir-release-security` (that project hosts only the Cloud Run
signer `liatir-runtime-box-signer` + KMS); (c) GitHub offers GPU-hosted larger
runners (1x NVIDIA T4, 4-core) for **both Linux and Windows** on Team/Enterprise
plans — fully managed, auto-scaling. So there is nothing to power on by hand;
these runners are configured under org/repo Settings → Actions → Runners →
GitHub-hosted runners as custom-labelled larger runners, and cost per-minute
while running (the priciest hosted tier).
Ref: <https://github.blog/changelog/2024-07-08-github-actions-gpu-hosted-runners-are-now-generally-available/>

**The GPU runners ARE configured (confirmed in the org Runners UI once GitHub
recovered).** Liatir org → Settings → Actions → Runners shows `liatir-linux-t4`
and `liatir-windows-t4` (runner group "Liatir Runtime Box GPU"), both **Ready**.
The 2026-07-20 CUDA queue was purely a **transient GitHub Actions outage** that
night (runner-admin API 500/503, Runners page would not load); it was not a
missing/offline runner. An earlier note in this file that read "not configured"
was wrong — it reflected the outage showing incomplete data, now corrected.

**Cost:** GPU runners are GitHub-managed larger runners, auto-scale to zero (no
idle cost), billed per-minute only while running: Linux GPU (T4, 4-core)
$0.052/min (~$1 per Linux CUDA release ≈ 18 min), Windows GPU $0.102/min (~$3.5–4
per Windows CUDA release). Maintainer rule: **optimise for one passing run, never
use a GPU run as a debugger** (validate cheaply on standard runners / locally
first).

## Next steps

> **In-flight strategic change (2026-07-24):** the [Runtime Box pixi
> migration](./roadmap/runtime-box-pixi-migration.md) is replacing the box
> builder with pixi + conda-forge on self-hosted runners and will re-validate
> every box on torch 2.8.0. **Phases 0–2 are done** (spike decisive on all three
> OSes; scGPT macOS pilot migrated and building; Rust layer unchanged);
> **Phase 3, self-hosted ephemeral CI, is the next one to start.** It reframes
> how the model-platform-expansion targets below are built and validated, so
> prefer migrating a target over rebuilding it on the old uv path. Each further
> phase begins only on explicit maintainer go-ahead, one at a time.

1. Execute the [Runtime Box model platform expansion](./roadmap/runtime-box-model-platform-expansion.md):
   first retrieve and diagnose the exact signing-build error from protected
   scGPT Linux CPU release `29955615971`, repair it behind cheap gates, and
   complete the protected release. Then close scGPT and UCE one target at a
   time on Windows CPU, Linux CPU, and Linux CUDA. Regress both existing macOS
   boxes to close P0, and keep Windows CUDA under the existing no-dispatch
   decision until its runner re-entry conditions hold. The repeated Windows
   foundation launcher `ENOENT` from run `29953770028` belongs to P2 and must
   be fixed before claiming Windows portability.
2. Close the true cross-version Runtime Box update and client-persisted signed
   anti-replay state as product work, not as an unclosed foundation gate.
3. Continue with the common execution spine in Phase 2 after that bounded
   Runtime Box product work.
4. Do not add another model family to the pre-release catalog until current
   model parity is closed and its code, weights, and assets pass an exact legal
   review. The candidate classification lives in `roadmap/ai-batches.md`.
5. Do not dispatch another Gate 9 UCE release; the on-demand runner remains
   offline unless a separately reviewed future heavy build requires it.
6. Do not dispatch Windows CUDA on the current hosted runner. Reconsider it only
   under the explicit re-entry conditions recorded in the canonical ledger.

## Standing constraints

- No paid, remote, publishing, or release action from memory — read back the
  exact workflow, inputs, and revision first (see `AGENTS.md` and the Runtime Box
  plan's operating rules). GPU runners are manual-only and need explicit cost
  approval.
- Keep user-owned roadmap edits out of technical commits.
- Update this file and the Runtime Box ledger whenever a gate changes state.
