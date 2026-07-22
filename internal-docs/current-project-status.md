# Current project status

Last updated: 2026-07-22 (Runtime Box CI foundation Gates 0–10 are complete;
the product AI Model catalog has been cut over to Runtime Box-only delivery).

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
  Windows CPU; its P0 local portability correction and P1 Linux CPU checked
  configuration are complete, with native evidence still pending.

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
Tauri system libraries at the Rust lifecycle stage. Cleanup succeeded and the
workflow fix is local; no publication, beta promotion, or support claim has
occurred.

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
  builds/checks, and the complete internal-docs build. No remote or paid action
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

1. Execute the [Runtime Box model platform expansion](./roadmap/runtime-box-model-platform-expansion.md):
   first correct shared scientific validator/accelerator portability, then
   close scGPT and UCE one target at a time on Linux CPU, Windows CPU, and Linux
   CUDA. Keep Windows CUDA under the existing no-dispatch decision until its
   runner re-entry conditions hold.
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
