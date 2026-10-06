# Current project status

Last updated 2026-10-06. This page says where Liatir stands and what comes next. How each piece got
here is in the [status log, July to September 2026](../history/status-log-2026-07-to-2026-09.md)
and in the plans under `history/`; the readiness of each product area, with its evidence, is in
[Beta 1 readiness](./roadmap/beta-readiness.md).

## Where Liatir stands

**The product works; it is not yet distributable.** The release-blocking scenarios in
[Beta 1 readiness](./roadmap/beta-readiness.md) are covered by native automated tests against a
real compiled app — pipelines, Jobs, Results and provenance, Native Tools, Plugins, API Connectors,
Nextflow, Local MCP and the AI Models — with the platforms each one covers listed there. What stands between the app
and a user is the [signed public distribution gate](./roadmap/release-signed-distribution.md),
which has not been started.

**Twelve AI Model targets across seven components are on the public `beta` channel**, all
Scrollcase v3, KMS-signed and with retained release evidence under `runtime-boxes/evidence/`:

| Component | Published targets |
| --- | --- |
| Geneformer V1 10M | `macos-aarch64-metal`, `linux-x86_64-cuda12.9` |
| scGPT whole-human | `macos-aarch64-metal`, `linux-x86_64-cpu`, `linux-x86_64-cuda12.9` |
| UCE 4-layer | `macos-aarch64-metal` |
| MHCflurry class I presentation | `macos-aarch64-metal`, `linux-x86_64-cpu` |
| pVACseq | `macos-aarch64-cpu`, `linux-x86_64-cpu` |
| Boltz-2 | `linux-x86_64-cuda12.9` |
| Protenix base v1.0.0 | `linux-x86_64-cuda12.6` |

Every Linux target also serves Windows through WSL2; there are no native Windows targets
([decision](../decisions/no-native-windows-runtime-box-targets.md)). `runtime-boxes/catalog.json`
is the source of truth for the exact releases and runs.

The Scrollcase v3 migration is closed: the app reads only v3 since `2ea19a7`, every published box
was republished as v3 (2026-09-24 to 2026-09-26), and the 127 stale v2 objects, about 215 GB, were
deleted from R2 on 2026-09-27 — see [Scrollcase v3 adoption](../history/scrollcase-v3-adoption.md).

## Completed scientific showcase

The [single-cell foundation-model study](../history/liatir_single_cell_showcase_codex_plan.md)
is complete with two documented UCE blockers: its original Mac checkpoint
exceeded the then-approved 2 GiB cap, and the PC has no published signed Linux
target. All ten feasible configurations ran through real native Liatir on the
complete PBMC (11,990 cells) and pancreas (16,382 cells) datasets. Nine Mac
representations and their original costs were reused byte for byte; only unfinished
pancreas scGPT inference ran anew on the explicitly approved RTX 4060 Ti profile,
six threads / batch 16, guarded 16 GiB RAM / 6 GiB whole-GPU memory, zero workload
swap. It completed in 515.536567396 seconds; whole-GPU peak was 4,799,332,352
bytes. The new CUDA checkpoint contains all 16,382 cells. Real interruption/resume
and changed-identity/guard refusal passed before full inference. Historical Mac
interruption and the separate 2,066-cell PC CPU checkpoint remain attached.

The twelve-row tables, all biological/batch/compute measurements, 22 reviewed
figures and [measured report](../../showcases/single-cell-foundation-benchmark/report/results.md)
are tracked. Independent metric reproduction passed at 1e-9 / 1e-8 tolerances;
canonical count/split checks were exact. The final seven-gate verify passed
87 unit files / 676 tests, and all 18 scientific regressions passed. Three relevant
native UI suites passed: ordinary native 48/0/32 explicit platform/heavy skips,
plus signed-index and two-process restart checks. The actual virtual Linux app
used its authorized development frontend; this is WSL2 native verification,
rather than a Windows release/package gate.

The complete portable export is in both checkouts' ignored showcase
`transfer/completed-study-final-wsl2-2026-10-05`. All 382 copied files were
SHA-256 verified, and the portable tools validated the actual Windows ZIP,
405,019,914 bytes, SHA-256
`184475f893e7f23efd24d095dccaccac8deefb79a525c0c7aa3d55a193f06de3`.
See [completion evidence](../../showcases/single-cell-foundation-benchmark/validation/completed-study/completion.json),
[tested reproduction](../../showcases/single-cell-foundation-benchmark/report/reproduction-validation.md)
and the [closed execution record](../history/single-cell-showcase-wsl2-execution.md).
Study completion on 2026-10-05 performed no paid job, GPU CI, new target
publication, release or remote push. On 2026-10-06 the user explicitly authorized
publishing all completed study commits to
`origin/handoff/single-cell-wsl2-2026-10-05`. The pending root ignore rules for the
original Mac archive and directory now use Git's forward-slash paths. Scientific
results and their validated portable ZIP remain unchanged. The full ignored
export is the recommended complete backup; its ZIP suffices for inspecting and
reproducing the measured scores. The separate canonical source cache exists
only in the Linux checkout and is needed for offline original-source checks.
The regular push succeeded and the remote revision was verified as
`0688d0be9f25a51b1857f84563038bbd4c55df03`, including the scientific completion
commit `86a4542a2554032c8d1f79d6f07ef855e07af712`. This verification receipt is
published by the following context-only commit on the same branch.

## What is open, in order

1. **Signed distribution** — [the release gate](./roadmap/release-signed-distribution.md), in
   progress for `0.1.0` ([decision](../decisions/desktop-distribution-channel.md)): updates from
   `updates.liatir.com` (R2 bucket `liatir-updates`) for macOS and Linux, downloads from the public
   `Liatir/liatir-releases` repository, Windows only through the Microsoft Store. The app checks for
   a newer version at startup and offers it in a notice. The bundled Native Tools are signed and
   notarized inside their box with Scrollcase 1.4.0. **0.1.0 is published** for macOS
   and Linux (release `v0.1.0`, feed live). The public site (`docs/`) has a Download page (`/download`)
   that reads the latest release from GitHub; the waiting list was removed on 2026-09-29, and the
   `liatir-mailing-list` D1 database, still holding its subscribers, was left untouched. Open: the Store submission, proof that Runtime Boxes
   work inside the MSIX container, and a real A-to-B update with 0.1.1.
   **0.1.1, published for macOS and Linux on 2026-10-01, fixes these 0.1.0 defects** (all three
   platforms now build on GitHub Actions, macOS signed and notarized there). First, the 3D Structure and trajectory viewers are blank under the production security
   policy, and the JBrowse genome viewer never started anywhere, because it could reach neither Web
   Storage nor local files from its sandbox
   ([decision](../decisions/viewers-run-in-a-static-sandbox-host-page.md)). The genome viewer now has
   native coverage with the real JBrowse (`tests/e2e/specs/genome-viewer.e2e.mjs`, network needed for
   the install). Second, the
   Single-cell Reference Index shows "unsupported signed single-cell index catalog document". The
   published catalog still has the v2 envelope, which `2ea19a7` stopped reading. Its signature
   covers only the payload, so `npm run single-cell-index -- migrate-catalog` republishes it
   unchanged in the v3 envelope. The admin token exists only in the `runtime-box-production`
   GitHub environment, so it runs there through `single-cell-index-catalog-migrate.yml`. **Done
   2026-10-01** (run 36863963482): the catalog at `models.liatir.com` now has the v3 envelope, the
   same payload (`cb8e66ca…2022d64`) and verifies against the production key, which fixes the page
   for 0.1.0 installations too.
   **Neither 0.1.0 nor 0.1.1 can install any Runtime Box**: every published box requires Liatir
   0.2.1. **0.2.1, published for macOS and Linux on 2026-10-01**, fixes it and is offered as an
   update to both ([details](./roadmap/release-signed-distribution.md)). It also lets the AI
   Models page offer a Linux CUDA box through WSL2 on Windows: Geneformer showed as unavailable
   there because the page considered only CPU boxes for WSL2, although the installer already
   routed CUDA ones. Its MSIX, not the 0.1.1 one, is the one to submit to the Store.
2. **OpenMM publication.** Both Linux targets are `native-lifecycle-validated` and the macOS CPU
   target is still `planned`; none is published. See
   [Phase 3 implementation status](./roadmap/phase3-implementation-status.md).
3. **The partial product areas** in [Beta 1 readiness](./roadmap/beta-readiness.md): the Quenta
   evaluation against a real local Ollama model, useful Plugin templates, and the structure pages' unexercised paths (the 56-atom warning, local
   file validation, PAE/PDE output). Also: the Native Tools boxes with the h5repack step single-cell
   quantification now runs were built, self-tested and signed in CI on 2026-09-28 (run
   36422000331, both targets); a Linux or Windows package must take the Linux box from that run —
   see the [single-cell vertical](./roadmap/single-cell-rnaseq-vertical.md); and on macOS a wide
   pipeline sometimes opens unframed, so the pipeline editor's framing test is intermittent there.
4. **Not built yet**: Protenix v2, which waits on ByteDance publishing its checkpoint
   ([decision](../decisions/protenix-ships-v1-while-v2-waits.md)); Protenix Mini Default, whose
   files are public but whose box has not been authored; and the MHCflurry
   `linux-x86_64-cuda12.9` target, still `planned`.
5. **Deferred**: Phase 4 of the [integration plan](./roadmap/new-ai-models-integration-plan.md),
   RFdiffusion3 and ProteinMPNN, not started.

One decision is still owed: whether UCE `beta.1`, unselected and v2-incompatible, belongs in the
revocations.

## Operational facts still in force

- **Repository context passes Syngraphe 0.4.1's strict check** as of 2026-09-29.
  The manifest now declares `protocol: repository-context`, and the outdated managed
  `AGENTS.md` block was refreshed by the CLI after a dry-run plan showed only that patch.
  Two archived references were corrected to the current AI Model ledger and state path.
  `syngraphe check --strict` reports no errors or warnings; a second initialization dry run
  has no operations. Existing context documents and VitePress/static assets were preserved.
  Public legal links in the internal site now use their public URLs, with repository source
  paths retained separately. The internal docs build and all seven `test:verify` gates passed
  (83 unit files / 654 tests).
- **Public legal pages distinguish Website rules from GNU GPL v3 software rights** as of
  2026-09-29. Both pages link to the official license; Website content restrictions,
  feedback, warranty/liability and access termination clauses preserve the applicable
  software license. Optional analytics and mailing list consent are not conditions for
  exercising software rights. See [legal page conventions](../truth/conventions.md#public-legal-pages-and-software-licensing).
  Validation: public docs build and both rendered HTML/Markdown license notices and links
  passed; all seven `test:verify` gates passed (83 unit files / 654 tests).
- **Public docs have generated Markdown copies and page actions** as of 2026-09-28:
  each documentation page offers Markdown Copy/View and Ask an AI; the build generates
  the copies alongside the existing AI index. Website deployment has not been verified.
  See [documentation conventions](../truth/conventions.md#public-markdown-and-page-actions).
  Validation: 65 published pages and their copies checked; ten Markdown generation/HTTP tests;
  headless browser checks for copy, View, AI prompt URLs, navigation and mobile width; docs build,
  Pages Functions compilation, and `test:verify` passed (83 unit files / 654 tests, seven gates).
  On 2026-09-29, the Cloudflare build of `97ee849` was reproduced in an isolated docs-only
  installation: math rendering needed `markdown-it-mathjax3`, which was declared only at the
  repository root. The docs manifest now declares it too, with its own lockfile updated.
  An isolated `npm ci` followed by the full docs build passed after the change, including
  the Quenta prebuild and all Markdown copies; all seven `test:verify` gates passed.
  A successful Cloudflare deployment of the dependency fix is still to be verified.
- **The repositories are `Liatir/liatir-app` and `Liatir/liatir-sdk`** since 2026-09-28 (formerly
  `liatir-stack` and `sdk`); Runtime Box signing was re-bound to the new name
  ([decision](../decisions/repository-names.md)).
- **A Runtime Box release runs on a self-hosted ephemeral runner, one at a time**, through
  `runtime-box-release.yml`: the Linux targets from the Windows host's WSL2, the macOS targets from
  the Mac. A runner does not survive its machine sleeping — on the Mac launch it under
  `caffeinate -dimsu`, lid open, on AC; in WSL2 start it with `setsid nohup … < /dev/null`, because
  a plain `nohup … &` dies with its `wsl.exe` session. Closing the Liatir window a lifecycle spec
  opens ends the run.
- **UCE needs about 20 GB free on the runner**; the release frees its build directory after
  publication so the lifecycle install fits.
- **Deleting from R2 by hand needs a current `wrangler login`**: an older token on the Mac lacked
  R2 access and every delete answered 403. Uploads still go only through GitHub Actions.
- **On Windows, `test:tauri:prepare` can fail with `EPERM`** while VS Code holds the frontend's
  native `.node` modules mapped; with the binary current, run the `ui` suites without
  `tauri-prepare`.

## Standing constraints

- No paid, remote, publishing, or release action from memory — read back the
  exact workflow, inputs, and revision first (see `AGENTS.md` and the Runtime Box
  plan's operating rules). GPU runners are manual-only and need explicit cost
  approval.
- Keep user-owned roadmap edits out of technical commits.
- Update this file and the Runtime Box ledger whenever a gate changes state.
- **Windows path length is a shared budget, and the product owns most of it.** The
  app spends 84 characters between the app data directory and the box's own tree
  (`.liatir\.main\data\ai-runtimes\<runtime-id>` plus staging), and a packaged conda
  environment brings paths over 110 more. A real install of the largest box reaches
  245 characters for a five-character user name and 258 for an eighteen-character
  one, against Windows' 260 limit for anything not long-path aware — which includes
  the box's Python. Shortening that prefix would return thirty characters, but every
  installed box already lives there, so it is a migration and not a cleanup. Do not
  answer a MAX_PATH failure by enabling long paths on a machine: that fixes one host
  and no user.
- **CPU support per AI Model is not mandatory.** A CPU Runtime Box ships only if
  the model finishes a realistic reference dataset inside an acceptable wall-clock
  time. The decision is per-model and based on measured throughput, never on the
  binary "it runs". If CPU takes hours, the CPU box is not shipped and the UI says
  the model needs a GPU or Metal. Shipping a technically-working but hours-slow box
  is a false promise to a non-technical user. Maintainer decision, 2026-07-23; the
  reference dataset size and the acceptable wall-clock are still to be set.
- **Scrollcase's maintainer is Liatir's maintainer.** Where a plan says "stop and
  ask the Scrollcase maintainer", that is an upstream API design conversation with
  them, not an external blocker. The vendor-neutrality rule still holds: Scrollcase
  never learns Liatir vocabulary, credentials or policy, and this repository never
  deep-imports or edits Scrollcase source.
- **Never assert the shape of a failure before reading its cause.** Install status,
  job status and install errors are all recorded by the app; on an ephemeral runner
  they disappear with the job. Read the error, then assert.
