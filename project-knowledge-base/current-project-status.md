# Current project status

Last updated: 2026-08-04 (the Runtime Box builder extraction is complete:
Scrollcase is an independent Apache-2.0 project outside this repository.
Liatir now pins exact public `scrollcase@0.4.11` and P5.2V has completed the
v2-only contract cutover. Scrollcase is not a Liatir workspace, vendored source
tree, or codebase to modify from this repository. Schema v1 is explicitly
unsupported rather than retained as a parallel reader. P5.3 is complete:
all three foundation v2 scrolls/locks/audits passed matching native validation
on macOS, self-hosted Linux and self-hosted Windows, and each old uv fixture was
removed only after its native proof. P5.4 is now in progress as one phase with
three operational blocks: scGPT v2, Geneformer CPU/Metal plus UCE, and the
Geneformer CUDA legacy/successor decision. Block 1 is complete. It started with
the scGPT Linux CPU input: it is now a single schema-v2 scroll with the existing pixi lock
preserved byte-for-byte and a Scrollcase v2 audit. Its complete native proof
passed in run `30599143569` on self-hosted runner
`liatir-linux-selfhosted-1785464985-360`: archive SHA-256
`1cdaafa35270bf53a6bdc722a7f3d8e0d26fec70f5e359192322a053ff3b5801`,
archive `1212137655` bytes, installed `3544428400` bytes and compact artifact
`8781444892`. Windows CPU is also a single schema-v2 scroll with its exact lock
and 94-package Scrollcase audit, and passed the complete native lifecycle in run
`30707681953` on runner `liatir-windows-selfhosted-1785600732-2300`: archive
SHA-256 `99fce2900499b83a6db83fe3de61403f792adf7cefaad26276b433a50e44f235`,
archive `566942596` bytes, installed `1478447610` bytes and compact artifact
`8821068033`. Linux CUDA 12.9 is likewise canonical v2 with its lock preserved
byte-for-byte and passed native lifecycle run `30709157030` on the RTX 4060 Ti:
archive SHA-256 `006796c1636eead60acaa65b8825054aa005bed96807f0768fcc60f1564135d7`,
archive `17098121591` bytes, installed `27706335619` bytes and compact artifact
`8821789904`. Windows CUDA 12.8 completed the requested Linux/Windows scGPT set
in native lifecycle run `30711089971`: archive SHA-256
`1ad3b68cb526d976ecd280479d053cd6323a1c5ea7af4bfe8aab1b07f6218e39`,
archive `4378954604` bytes, installed `7053500062` bytes and compact artifact
`8822298430`. All four Linux/Windows scGPT targets are now canonical v2 and
natively proven. The macOS Metal authoring input is also canonical v2: its
existing pixi lock remains byte-identical at SHA-256
`04f83b64db8b5f6faf65fa40c677d6596a50c7d5482c51d8c1baa173588b388a`,
published `scrollcase@0.4.11` generated and checked its 100-package audit, and
native CI resolves to the dedicated `liatir-macos-arm64-heavy` self-hosted
runner. First native run `30715635531` at commit `c855e66` passed the clean
build, local signing, archive verification and self-test, then failed closed in
the real scientific forward because the inherited macOS prune list removed
locked `sympy`, which PyTorch 2.8 imports lazily. Rust lifecycle therefore did
not run. Failure artifact `8823318701` is incident provenance, not acceptance
evidence. The Liatir scroll now retains every locked runtime dependency, matching
the other four scGPT v2 targets, and a cross-target regression forbids `venv/`
prune paths. The single authorized retry, run `30763954679`, job `91539336858`,
passed clean build, signature and archive verification, scientific Metal parity
and Rust install/activate/rollback/removal lifecycle on runner
`liatir-macos-heavy-1785699749-3285`. Archive SHA-256 is
`d1d39e44a24de0ef4808df27225eb8a9834c0e10d4a40a2171e2c76140231e81`,
archive size is `687615488` bytes, installed size is `1863803480` bytes and
compact artifact `8838446367` preserves the proof. All five scGPT targets are
now canonical v2 and natively proven, so block 1 is complete. P5.4 remains open
at block 2. Its first target, `geneformer-v1-10m-macos-arm64-metal`, is now a
single schema-v2 scroll on pixi 0.73.0 with Python 3.11.15 and PyTorch 2.8.0;
the old schema-v1 uv input and lock are removed. Lock SHA-256 is
`3e9841b2296656458715aa1276ece999b2bdfe4566e8dfdf77c0e29496c4d19f`,
and the matching Scrollcase v2 audit covers 161 conda packages with no PyPI or
source-build escape hatch. Native-lifecycle run `30766478916`, jobs
`91546006154` and `91546052389`, passed from clean commit `6fe5a07` on ephemeral
self-hosted runner `liatir-macos-heavy-1785703738-15134`: frozen build,
signature/archive verification and self-test, real torch 2.8.0 Metal parity,
and Rust install/activate/rollback/removal lifecycle. Installed size is
`2179953895` bytes, archive size is `672331169` bytes and archive SHA-256 is
`3ce6e4baecae7a641da6a6ecd2a71148f3d9c62f44e42fd5baa04a8110b0ae62`.
The finite `[4, 256]` embedding passed at maximum absolute error
`8.121132850646973e-7` and minimum cosine similarity
`0.9999999403953552`. Compact artifact `8839187730` preserves the acceptance
evidence. The runner deregistered and its marked root was removed. The second
block-2 target, `geneformer-v1-10m-linux-x86_64-cpu`, is a single schema-v2
scroll on pixi 0.73.0 with Python 3.11.15 and PyTorch 2.8.0; the legacy uv
descriptor and locks are removed. The committed Linux lock SHA-256 is
`551716a80946450c076c9c0184458b5a29da855117b13a9da98129f4a19e16b4`,
and the matching `scrollcase@0.4.11` conda audit reviews 171 packages with no
unresolved licence. Native-lifecycle run `30872534594`, jobs `91877296883` and
`91877388153`, passed from clean commit `6a26a35` on ephemeral self-hosted
runner `liatir-linux-selfhosted-1785811312-359`: frozen build,
signature/archive verification and self-test, real torch 2.8.0 CPU scientific
validation, and Rust install/activate/rollback/removal lifecycle. Installed size
is `3959042677` bytes, archive size is `1232703132` bytes and archive SHA-256 is
`ead3546f6e39fb5d4e513ad9dbd33374a80e208566eef4e352152180cf320c6e`.
The finite `[4, 256]` embedding passed at maximum absolute error
`8.67992639541626e-7` and minimum cosine similarity `0.9999999403953552`, with
output and provenance contracts green. Peak additional runner disk was
`6244888576` bytes, so the catalog disk plan now carries those measured sizes
inside the retained 12 GiB floor. Compact artifact `8878554308` preserves the
acceptance evidence; the runner deregistered and its marked root was removed.
The third block-2 target, `geneformer-v1-10m-windows-x86_64-cpu`, is also a
single schema-v2 scroll on pixi 0.73.0 with Python 3.11.15 and PyTorch 2.8.0
`cpu_mkl`, resolved only from conda-forge; the legacy uv descriptor and locks
are removed. The committed Windows lock SHA-256 is
`17aaea6dd7c4fdca8d37c6898c82020c210b21458f53d22d03b2f3b3324438ab`,
and the matching `scrollcase@0.4.11` conda audit reviews 150 packages with no
unresolved licence. `pythonEntryPoint` stays `venv/python.exe`, and catalog
identity, asset hashes and the immutable `1.0.0-beta.1` publication metadata
are unchanged. Native-lifecycle run `30915003666`, jobs `92010824861` and
`92011005131`, passed on the first dispatch at clean commit `d337977` on
ephemeral self-hosted runner `liatir-windows-selfhosted-1785850729-16884`:
frozen build, signature/archive verification and self-test, real torch 2.8.0 CPU
scientific validation, and Rust install/activate/rollback/removal lifecycle.
Installed size is `1824134154` bytes, archive size is `493253025` bytes and
archive SHA-256 is
`afc48a00f1f6cfe3b557069c8d77169f95327b257887c50a1c32126eb5a4a684`.
The finite `[4, 256]` embedding passed at maximum absolute error
`4.470348358154297e-7` and minimum cosine similarity `1`, with output and
provenance contracts green. Peak additional runner disk was `3558084608` bytes,
so the catalog disk plan carries those measured sizes inside a reduced 8 GiB
floor. Compact artifact `8895358103` preserves the acceptance evidence; the
runner deregistered and its marked root was removed. All three Geneformer
CPU/Metal targets are now v2 and natively proven. The next block-2 continuation
is UCE.
No signing, publication or promotion occurred. Published
scGPT `0.2.5-beta.1` and Geneformer `1.0.0-beta.1` objects remain immutable. The
full CI substrate migration to pixi + pixi-pack +
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
because the resolve job is what tells the operator which runner to start. Native jobs
queue until the operator brings the matching runner online — the established Gate 9
on-demand model — and **many self-hosted validation runs have since executed** (the
scGPT results below).
**Phase 4 is also complete**: GPU runner profiles now declare capability and VRAM
**floors** (compute ≥ 7.5, ≥ 7.5 GB) instead of pinning one exact card, and the
parity validator, host probe, evidence record and CUDA E2E no longer hard-code a
Tesla T4 — so the local RTX 4060 Ti is accepted. CUDA has since been **exercised for
real on the 4060 Ti** (the scGPT CUDA runs below). The old 15 GB VRAM floor had
no scientific basis: the reviewed CUDA run measured a peak of ~102 MiB. **Phase 5 is
in progress**: scGPT `linux-x86_64-cpu` is migrated off uv onto pixi, and
`windows-x86_64-cpu` is added as a new target that never had a uv recipe — both with
committed `pixi.lock` files, lock-derived conda licence audits (112 and 94 packages,
all licensed), measured `diskPlan` floors, and wiring into the catalog, signer policy
and workflow. They started `buildable`; their current validated statuses are below, and
**nothing has been signed, published or promoted**. **scGPT Linux CPU is now scientifically validated natively on the self-hosted
runner** — the first pixi box built and validated in CI (run `30132956412`, mode
`scientific`, ~9.5 min on an ephemeral WSL runner): pixi 0.73.0, torch 2.8.0 CPU,
a finite `1 x 512` embedding, self-test and output/provenance contracts all passed,
measured installed 3.55 GB / archive 1.21 GB within the diskPlan floors. **scGPT
Windows CPU is likewise scientifically validated natively** on the self-hosted Windows
runner (run `30134159371`, torch 2.8.0 CPU, finite `1 x 512`, installed 1.39 GB /
archive 0.53 GB). **scGPT Linux CPU has also passed `native-lifecycle` on CI** (run
`30135717742`: Tauri built with Rust 1.95 and the `cargo test runtime_box` suite run
against the pixi box), advancing to `native-lifecycle-validated`; this needed a scoped
passwordless `apt-get` on the WSL runner (`/etc/sudoers.d/liatir-runner`). scGPT
Windows CPU `native-lifecycle` also passed (run `30136322406`; no sudo needed, VC++
tools already present), so **both scGPT CPU targets are now fully validated in CI at
build, scientific and native-lifecycle** and sit at `native-lifecycle-validated`. **The macOS
shared-launcher re-check is now DONE** (2026-07-25, local zero-cost on the maintainer's
Apple-Silicon Mac): the cross-OS launcher's Darwin branch passed `--preflight-only`
(`Self-hosted runner preflight passed for liatir-macos-arm64-heavy with 45410160640
free bytes`, exit 0, registered nothing, inventory stayed empty), exercising the
`Darwin:arm64` host detection, `shasum -a 256` path, catalog resolve, host/target guard
and disk floor. The optional native pixi box build was also run: scGPT
`0.2.5-beta.1` macos-aarch64-metal built and signed on the pixi substrate, and
`verify --self-test` passed (`Verified scgpt-whole-human 0.2.5-beta.1
(macos-aarch64-metal)`), loading `best_model.pt` on torch 2.8.0 Metal — measured
archive 655,752,216 B (≈0.61 GB); build/dist cleaned up afterwards.
**scGPT Linux CUDA 12.9 is now scientifically validated on the RTX 4060 Ti** —
the first CUDA box on the pixi substrate and the first CUDA validation on the
local GPU (run `30141976372`): pytorch 2.8.0 cuda129, CPU-vs-CUDA parity passed
(cosine 0.99999999999994), peak VRAM ~209 MiB, GPU identity matching the host.
This proves the Phase 4 hardware generalization end to end. **scGPT Windows CUDA
12.8 is likewise validated on the 4060 Ti** (run `30143289750`, parity cosine
0.9999999999999, box installed 6.58 GB / archive 4.08 GB — much smaller than
Linux CUDA, which inflates from symlink dereference that Windows does not do); it
passed on the first dispatch by applying the Linux CUDA lessons up front. **scGPT
is now natively proven on all five targets**, including the macOS Metal v2
rebuild. The Linux CUDA run took five dispatches,
each a distinct defect in the new CUDA path or the WSL host (CPU-cloned self-test,
/tmp tmpfs too small for verify, a dropped checkpoint download, missing
GPU-identity evidence), never the box or the CUDA compute itself; those fixes are
permanent. Geneformer macOS Metal, Linux CPU and Windows CPU are also complete
on v2.
Remaining Phase 5: complete the later Geneformer and UCE targets. After that,
only the
protected release remains per target, gated on the maintainer's go-ahead and a
prior signer deploy.

Before any protected release the signer must be deployed, because the
previous failure was deployed-policy drift, not a build defect. **That drift
is now caught automatically**: the signer exposes a policy fingerprint on
`/health`, and the release workflow fails fast (right after GCP auth, before
the paid build) if the deployed policy does not match the committed one,
pointing the operator at `runtime-box:signer:deploy`. It deliberately does
not auto-deploy — that would hand the release job the signer's admin rights.
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
  the historical pre-pixi execution ledger for scGPT/UCE portability and early
  protected-release defects. Its evidence remains useful, but its target table
  and dispatch instructions are superseded by the pixi migration and Scrollcase
  P5 plan.
- [Runtime Box pixi migration](./roadmap/runtime-box-pixi-migration.md) — the
  active Liatir recipe/runner/scientific migration onto the independent
  Scrollcase pixi + conda-pack + conda-forge builder (Variant A + a contained
  PyPI escape hatch), using self-hosted GitHub Actions runners and torch 2.8.0.
  **Phases 0–4 complete; Phase 5 in progress** — all five scGPT targets plus
  Geneformer macOS Metal, Linux CPU and Windows CPU have complete native v2
  proof, including
  real CUDA on the self-hosted RTX 4060 Ti. Remaining Phase 5: complete later
  Geneformer and UCE targets, then the protected releases. The uv path is
  retained only for not-yet-migrated recipes.
- [Runtime Box pixi Phase 0 spike](./roadmap/runtime-box-pixi-phase0-spike.md) —
  the decisive local relocation/activation decision record: conda-pack, **no
  activation env on any OS (macOS, Windows and Linux, CPU + CUDA)**, `venv/`
  box layout, footprints ≈833 MB (macOS) / ≈1.35 GB (win CPU) / ≈6.5 GB (win CUDA)
  / ≈1.63 GB (linux CPU) / **≈9.5 GB (linux CUDA, the largest box in the matrix)**,
  CUDA pinned per-OS at 12.8 (win-64) and 12.9 (linux-64). The Linux CUDA proof ran
  under WSL2's driver bridge, so it is strong evidence rather than bare metal;
  cuDNN/cuBLAS/libtorch_cuda were all verified to load from the relocated prefix.
- [scrollcase extraction plan](./roadmap/scrollcase-extraction-plan.md) — the
  extraction of the Runtime Box **builder** into an independent Apache-2.0
  open-source tool named Scrollcase. **Extraction phases P1–P4 are complete
  (2026-07-26):** the canonical source is now the standalone public repository
  `https://github.com/suffro/scrollcase`, documentation is live at
  `https://scrollcase.dev`, and Liatir now consumes exact public
  `scrollcase@0.4.11`. The `0.1.0`–`0.1.3` releases remain historical extraction
  milestones: `0.1.1` added public TypeScript declarations, `0.1.2` added
  browser-safe contract helpers, and `0.1.3` safely handled conda symlink chains
  while removing machine-specific conda metadata. The temporary
  in-tree copy was removed from Liatir in `6b4934e`.
  Scrollcase is a pixi + conda-pack + conda-forge CLI and library with seven verbs
  (`init`, `doctor`, `keygen`, `lock`, `audit`, `build`, `verify`), deterministic
  signed boxes, generated schema-derived contract types, licence audit,
  embed/on-demand weights, declared accelerator parity, and local or external
  signing. Its managed per-project toolchain bootstrap requires explicit consent
  and verifies the downloaded pixi archive; the shared `--global` toolchain is
  deliberately outside the current package. The `0.1.2` standalone release gate
  passes 113 tests across 11 files, generated-declaration checks, the docs build,
  tarball inspection, and a browser bundle. The original extraction CI run
  `30209373381` passed all 11 Node 20/22/24 jobs across Linux, macOS and Windows
  plus package/audit/docs gates.
  **The schema-v1 P5.0–P5.2 record is historical. P5.2V is complete on exact
  `scrollcase@0.4.11`; P5.3 is complete on macOS, Linux and Windows native
  evidence.**
  `@liatir/core` consumes/refines the published
  generic contract. The active adapter routes doctor/keygen/verify and pixi
  lock/audit/build through exact installed `scrollcase@0.4.11`, forces the existing namespace,
  supplies the private Cloud Run signer through Scrollcase's external-command
  boundary, and keeps CI/evidence/distribution in Liatir. That is consumer-side
  integration only: no Scrollcase source is present or modified here.
  The workflow widening was removed and foundation native fixtures are now
  manual-only; heavy model-native jobs remain explicit and self-hosted. The
  independent `0.1.3` fix was consumed only through its published package.
  The v2 stdlib fixture completed real key generation, unchanged committed lock
  resolution, two deterministic builds, conda-pack, stdlib self-test, a signed
  `liatir.runtime-box.release`, separate `verify --self-test`, Node consumer
  execution and Rust activation/rollback/removal plus v1 rejection. The macOS
  foundation uv recipe was removed only after that native proof. Linux run
  `30594110843` passed on
  `3de11868c510665544d54f9251496c479d02866a` with archive SHA-256
  `4968084661a0fc98b36dd2e86f37e5642ba092afd8078459e7a7a1ae5fc94fca`,
  archive size `200216832` bytes and installed size `506827820` bytes.
  Windows run `30595863980` passed on
  `1dc25fd25d299f970fbc0501197267e03ec50d16` with archive SHA-256
  `e0455e6de2fa86b18ae47581e2cb47048520b114d7f003141fef1d5a8561c4bc`,
  archive size `44718074` bytes and installed size `126224685` bytes. Both
  matching uv fixture directories were removed only after those proofs.
  Failed precursor runs `30565143883` (missing generated bridge ordering) and
  `30594990987` (Windows symlink privilege in the TAR rejection fixture) remain
  incident provenance, not acceptance evidence; cancelled old run
  `30548041903` is also not valid evidence. Public
  `scrollcase@0.4.11`, inspected
  from its npm tarball on 2026-07-30, requires schema v2 and a nested
  `scrolls/<boxId>/<targetId>/scroll.json` authoring layout. The canonical P5 plan
  now requires Liatir to replace the active contract completely with v2, reject
  v1 explicitly, provide bounded cleanup for already installed v1 state while
  preserving Results/provenance, then migrate those recipes and delete the
  superseded local generic builder copies.
  The remaining Geneformer and UCE targets still require pixi recipes before
  Scrollcase can build them.
  Liatir continues to own Runtime Box distribution and product concerns: CI/runner
  policy, scientific validation, R2/Registry publication, KMS custody, trust roots,
  Rust/Tauri installation, Jobs, Results and provenance.
- [Scrollcase P5 — Liatir adoption](./roadmap/scrollcase-p5-liatir-adoption.md) —
  the detailed implementation plan for consuming the published package, inverting
  the generic contract, adding the Liatir signer/evidence/distribution adapter,
  migrating the remaining uv model recipes, preserving legacy CUDA target identity,
  and retiring the local generic builder. Status: **the v1 P5.0–P5.2 baseline is
  historical; P5.2V is complete on exact `scrollcase@0.4.11`, and P5.3 is
  complete on macOS, Linux and Windows; P5.4 is in progress, with all five scGPT
  targets plus Geneformer macOS Metal, Linux CPU and Windows CPU migrated and
  natively
  proven**. It consumes generic
  types and browser-safe helpers, preserves `liatir.runtime-box.*`, and passes
  the complete `test:verify` gate with 227 unit/contract tests. The stable CLI is
  locally implemented as a thin adapter; pixi operations are intended to use the
  installed external tool, while distribution and the visible temporary uv
  compatibility branch remain Liatir-owned only for not-yet-migrated P5.4 model
  recipes. Core, frontend, signer, Registry and Rust/Tauri now use the
  published-v2 contract, active v1 parsing is removed, and installed v1 state
  has explicit unsupported/removal behavior without rewriting historical signed
  boxes. The foundation workflow is manual, selects one fixture per dispatch,
  runs all checks on the selected ephemeral self-hosted Linux/Windows runner,
  and has no GitHub-hosted preflight. No trust root, published box, remote
  runner, publication, promotion or deployment changed at this checkpoint.

## Where the project is

Phase 1 of the Scientific AI Workbench plan is complete: the Runtime Box CI
foundation has closed Gates 0 through 10. Product-level Runtime Box work now
has two explicit tracks: cross-version update with client-persisted anti-replay
state, and cross-platform expansion of the current model catalog before new
model families are admitted. The common execution spine follows in Phase 2.
The cross-platform track now has a canonical target-by-target execution plan.
(This section from `29951xxxxx` onward is the pre-pixi uv-era narrative, kept as
history; the pixi migration has since superseded these target states — see the top
of this file and the pixi migration plan for current statuses.)
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
or beta promotion. Cleanup passed. **Diagnosed 2026-07-24: it was not a build
defect but deployed-signer policy drift.** The signer returned
`signing_rejected / "target is not approved for this box"`. The repository policy
already listed `scgpt-whole-human → linux-x86_64-cpu` (added by `b3a9a1f`, an
ancestor of the released commit), but committing `policy.json` does not deploy it,
and `runtime-box:signer:deploy` had never been run — so the live Cloud Run
revision served an older policy. The fix is a signer deploy before the retry; no
builder change is needed. The drift check is now automated (the release fails fast
if the deployed signer policy is stale — see the pixi migration plan). **Superseded:**
this uv-era Linux CPU target has since been migrated to pixi and, on that substrate,
validated at build + scientific + native-lifecycle; the uv release above was never
retried.

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

## Historical hosted GPU runner snapshot (2026-07-20 — superseded)

This section records the old paid larger-runner configuration and the incidents
that occurred on it. It is not the current runner topology. The
`liatir-linux-t4` and `liatir-windows-t4` profiles were later deleted; current
Linux/Windows model-native validation resolves to reviewed on-demand
self-hosted profiles. Only coordination/preflight jobs remain hosted by design.

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

> **Current strategic routing (2026-07-27):** the [Runtime Box pixi
> migration](./roadmap/runtime-box-pixi-migration.md) owns Liatir recipe,
> self-hosted-runner and scientific migration. The independent external
> Scrollcase package owns the generic pixi builder, and
> [Scrollcase P5](./roadmap/scrollcase-p5-liatir-adoption.md) owns downstream
> adoption/legacy retirement. Phases 0–4 of the pixi migration are complete;
> Phase 5 is in progress; the historical v1 P5.2 checkpoint, v2-only P5.2V
> cutover and all three native P5.3 foundation proofs are complete. P5.4 model
> recipe migration is in progress: all five scGPT targets plus Geneformer macOS
> Metal, Linux CPU and Windows CPU are v2 and natively proven; UCE is the next
> one-target continuation.
> It remains one phase with
> three operational blocks rather than a new numbered checkpoint per target.
> Do not use the historical
> platform-expansion target table as a dispatch source.

1. Continue the [pixi migration](./roadmap/runtime-box-pixi-migration.md) Phase 5,
   which has **reframed and largely absorbed** the old model-platform-expansion
   plan. Done: the `29955615971` signing failure was diagnosed (deployed-signer
   policy drift, now auto-detected before every release), and all five scGPT
   targets plus Geneformer macOS Metal, Linux CPU and Windows CPU are natively
   proven on v2.
   Remaining: migrate
   and validate later Geneformer and UCE targets before protected releases
   (each gated on the maintainer's go-ahead and a prior `runtime-box:signer:deploy`).
   Windows CUDA is no longer under the no-dispatch decision — it now validates on
   the self-hosted RTX 4060 Ti.
2. Close the true cross-version Runtime Box update and client-persisted signed
   anti-replay state as product work, not as an unclosed foundation gate.
3. Continue with the common execution spine in Phase 2 after that bounded
   Runtime Box product work.
4. Do not add another model family to the pre-release catalog until current
   model parity is closed and its code, weights, and assets pass an exact legal
   review. The candidate classification lives in `roadmap/ai-batches.md`.
5. Do not dispatch another Gate 9 UCE release; the on-demand runner remains
   offline unless a separately reviewed future heavy build requires it.
6. Do not dispatch the legacy Geneformer Windows CUDA 12.4 candidate from the
   historical hosted-runner plan. scGPT Windows CUDA 12.8 has self-hosted
   scientific evidence but remains unpublished; any further validation or
   release still needs one explicit reviewed target authorization.

## Standing constraints

- No paid, remote, publishing, or release action from memory — read back the
  exact workflow, inputs, and revision first (see `AGENTS.md` and the Runtime Box
  plan's operating rules). GPU runners are manual-only and need explicit cost
  approval.
- Keep user-owned roadmap edits out of technical commits.
- Update this file and the Runtime Box ledger whenever a gate changes state.
