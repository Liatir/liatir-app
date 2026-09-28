# Current project status

Last updated 2026-09-28. This page says where Liatir stands and what comes next. How each piece got
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

## What is open, in order

1. **Signed distribution** — [the release gate](./roadmap/release-signed-distribution.md). The
   recommended order is macOS first: the Apple Developer Program membership is active, so what is
   missing is issuing the Developer ID identity and notarization credentials, then a signed and
   notarized build, a clean-machine install and a real signed A-to-B update. Windows goes through
   the Microsoft Store, which still needs its packaging route verified (MSIX, no in-app updater,
   Runtime Boxes inside the container); Linux package signing is unwritten.
2. **OpenMM publication.** Both Linux targets are `native-lifecycle-validated` and the macOS CPU
   target is still `planned`; none is published. See
   [Phase 3 implementation status](./roadmap/phase3-implementation-status.md).
3. **The partial product areas** in [Beta 1 readiness](./roadmap/beta-readiness.md): the Quenta
   evaluation against a real local Ollama model, useful Plugin templates, native coverage for the
   genome (JBrowse) viewer, and the structure pages' unexercised paths (the 56-atom warning, local
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
