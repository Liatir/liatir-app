# Runtime Box cross-platform CI foundation

This tracked document is the durable implementation plan and handoff source for
Runtime Box CI work. Keep it current so development can continue from a local
checkout or GitHub Codespaces without relying on machine-local agent memory.

**Current routing note (2026-08-10):** Gates 0–10 below are closed historical
evidence for the original uv-era foundation. They remain authoritative for the
product, trust, distribution and lifecycle guarantees they proved, but not for
current generic builder ownership or every later target status. Scrollcase is
now an independent external npm tool and Liatir's active adoption/migration
state lives in
[Scrollcase P5](./scrollcase-p5-liatir-adoption.md),
[the pixi migration](./runtime-box-pixi-migration.md), and
`runtime-boxes/catalog.json`. The later migration and release are complete: the
public `beta` channel serves nine schema-v2 targets across Geneformer, scGPT and
UCE, including Linux CUDA 12.9 and Windows CUDA 12.8. Geneformer and scGPT
`beta.1` are revoked; UCE `beta.1` is unselected and v2-incompatible but not
explicitly revoked. Statements such as “CUDA is validated only on Linux” are
true only at the dated Gate 10 closure.

**P5.3 v2 foundation revalidation (2026-07-31):** the manual-only
`runtime-box-foundation.yml` remained entirely self-hosted and completed the
remaining native proofs without any GitHub-hosted job. Linux run `30594110843`
passed at `3de11868c510665544d54f9251496c479d02866a` on
`liatir-linux-selfhosted-1785458323-362`; artifact `8779573721` records archive
SHA-256
`4968084661a0fc98b36dd2e86f37e5642ba092afd8078459e7a7a1ae5fc94fca`,
`200216832` archive bytes and `506827820` installed bytes. Windows run
`30595863980` passed at `1dc25fd25d299f970fbc0501197267e03ec50d16` on
`liatir-windows-selfhosted-1785460565-23168`; artifact `8780252596` records
archive SHA-256
`e0455e6de2fa86b18ae47581e2cb47048520b114d7f003141fef1d5a8561c4bc`,
`44718074` archive bytes and `126224685` installed bytes. Failed precursor runs
`30565143883` and `30594990987` are retained only as incident provenance. The
cancelled run `30548041903` targeted an earlier revision and is not acceptance
evidence. P5.3 is complete; P5.4 remains pending and was not started.

**Native Windows CUDA is validated for the first time (2026-08-05).** The Gate
8.2 re-scope below named three re-entry conditions; one of them — "a self-hosted
R525+ Windows runner is added" — is now exercised, and the "local validation on
the maintainer's RTX 4060 Ti planned separately" note in the gate table is
executed. Geneformer `windows-x86_64-cuda12.8` passed a complete native
lifecycle in run `31057320891` on `liatir-windows-cuda-selfhosted-1785973279-480`
(driver `610.62`, compute capability `8.9`), after Geneformer
`linux-x86_64-cuda12.9` passed in run `31048217909` on
`liatir-linux-cuda-selfhosted-1785964781-457`. Both are recorded
`native-lifecycle-validated` at that checkpoint and were subsequently published
as `beta.2`; details live in
[Scrollcase P5](./scrollcase-p5-liatir-adoption.md) and
`runtime-boxes/catalog.json`.

Four boundaries on that sentence, so it is not over-read:

1. **No gate is reopened or re-closed.** Gate 8.2's own subject was
   `windows-x86_64-cuda12.4`, which was deleted on 2026-08-04 together with
   `linux-x86_64-cuda12.4`. The validated targets are new, additive identities,
   not the deferred one revived. Gate 8.2 stays closed on `windows-x86_64-cpu`
   as recorded.
2. **The hosted-runner blocker is unchanged.** The GitHub-hosted Windows GPU
   runner's driver is still too old, so Windows CUDA remains out of hosted CI and
   the `AGENTS.md` safety note still applies verbatim. What changed is that a
   self-hosted path now exists and has been used; nothing about version
   constraints was loosened.
3. **The Linux-first rule held, through code rather than convention.** The
   catalog enforces it: `windows-x86_64-cuda12.8` carries
   `linuxValidationPrerequisiteTargetId` and could not set `nativeCiEnabled`
   until the Linux target's status recorded scientific validation. The operating
   rule below asks for same-model Linux CUDA evidence "for the exact commit";
   the Linux run is at `53c3a21` and the Windows run at `5960026`, and that
   delta contains no scroll, lock, licence audit, validator, product script or
   workflow change — only catalog bookkeeping and documentation.
4. **The uv-era identity list under "Objective" below is not current.** It
   predates the CUDA 12.4 deletions and the 12.9/12.8 successors, and the
   Geneformer matrix it describes — including Linux and Windows CPU — no longer
   exists; Geneformer's CPU boxes were dropped on a measured `~160` ms per cell.
   Read `runtime-boxes/catalog.json` for live target identities, per the routing
   note above.

## Historical objective at foundation start

Prove that Liatir can build, validate, sign, publish, install, run, and remove a
real AI Model Runtime Box on every supported native target while preserving one
shared contract in `packages/liatir-core`.

The canonical target identities recognized by the shared contract are:

- `macos-aarch64-metal`
- `macos-aarch64-cpu`
- `linux-x86_64-cpu`
- `linux-x86_64-cuda12.4`
- `windows-x86_64-cpu`
- `windows-x86_64-cuda12.4`

macOS Intel and Linux arm64 are not active Runtime Box targets. Native Windows
CUDA support must not be inferred from WSL2 or a Linux runner.

The current supported Geneformer matrix is narrower: macOS arm64 Metal, Linux
x86_64 CPU, Linux x86_64 CUDA 12.4, and Windows x86_64 CPU. Windows CUDA 12.4
remains a recognized, buildable identity but is unvalidated, unpublished, and
unsupported under the 2026-07-21 re-scope.

## Operating rules

- Work linearly, one gate and one native target at a time.
- Never batch paid GPU runners. GPU work is manual-only and scoped to one model
  and one target with concurrency `1`.
- Run cheap legal, catalog, dependency-lock, and peak-disk checks before a paid
  runner is allocated.
- Linux T4 is the first CUDA gate. If Windows CUDA is explicitly brought back
  into scope, it requires successful same-model Linux CUDA evidence for the
  exact commit in addition to a compatible native Windows runner.
- Cancel stale validation jobs, but never cancel production release jobs.
- Do not cache model weights, Runtime Box archives, or uv downloads.
- Long native and scientific commands emit one concise heartbeat every five
  minutes. Never use continuous polling such as `gh run watch`.
- Use one bounded status check after a meaningful interval and report only a
  transition, completion, failure, or actionable finding.
- Before starting a paid runner, state the expected runner, timeout, and cost
  exposure and obtain explicit user approval.
- Keep code, comments, workflow text, CLI output, and developer documentation in
  English.
- Do not start a later gate while the current gate has unresolved problems or
  missing evidence.

## Current status

| Gate | Status | Durable evidence |
|---|---|---|
| 0. Target identity | Complete | `0fc2002` |
| 1. Native builder adapters | Complete | `a610b3a` |
| 2. Synthetic native foundation | Complete | `41999f4`, `4f302e5`, `67332d0`, `9c2a961` |
| 3. Host selection and activation provenance | Complete | `05ecd32` |
| 4. Workflow topology | Complete | through `c6503c5` |
| 5. GitHub identities, environments, and secrets | Complete | `4aa84f2` |
| 6. Evidence and artifact policy | Complete | `58fd1df` |
| 7. Cost and trigger controls | Complete | `046190d` |
| 8.1. Geneformer Linux pilot | Complete | CPU run `29547725429`; CUDA run `29643382673`; publication contract `07c6c69` |
| 8.2. Geneformer Windows CPU | Complete | Release run `29706828552` (commit `f067482`) passed the full protected release on `windows-x86_64-cpu`: KMS-signed build, native self-test, scientific validation, immutable publication with public hash verification, the complete product lifecycle E2E (install, interrupted-download resume, real Geneformer inference with a finite 256-dim CPU embedding, Jobs/Results/provenance, replacement, rollback, and cleanup), and beta promotion. The `beta` channel now serves the Windows CPU box |
| 8.2. Geneformer Windows CUDA | Deferred — out of Gate 8 scope (2026-07-21 re-scope), not a supported target, does not block later gates | Recipe + wiring built and validated GPU-free (commit `4127e7d`; host-probe nvidia-smi fixes through `a9af8c6`; target status `buildable`, never published). Hard blocker: the GitHub Windows T4 runner has NVIDIA driver `471.11` (R470), too old for CUDA 12.4 — host-probe rejects it (`driver 471.11 is below 551.61`) in ~1 min before any paid build. Decision 2026-07-21: excluded from CI until GitHub ships a newer Windows GPU driver (or a self-hosted R525+ runner / a separate `windows-x86_64-cuda11.8` target). Local validation on the maintainer's RTX 4060 Ti planned separately |
| 8.3. Cross-platform closure | Complete | macOS regression run `29880520628` at `d07b6b4` passed preflight, clean native build, self-test, Metal scientific parity, Rust lifecycle, evidence upload, and cleanup; artifact `8514665653` (`sha256:b1b4911121897542bed0961bd0e93ac2ca88c7d17f6229913733a0a062630c74`). The reviewed four-target evidence chain, catalog/core alignment, and readiness matrix are recorded below. Deferred Windows CUDA remains unsupported and excluded by the 2026-07-21 re-scope |
| 9. macOS arm64 heavy runner | Complete | Protected release run `29909249357` at `8e12512` passed on the repository-scoped ephemeral runner: clean build, KMS signing, independent native self-test, UCE Metal scientific parity, immutable R2 publication with public hash verification, beta promotion, compact evidence, unconditional workflow cleanup, runner deregistration, and marked-root removal. Artifact `8525984364` has digest `sha256:8166557f9953e4713e577558da5fe485d732e57aef299dbb54fb35630842fbaf` |
| 10. Documentation and operational handoff | Complete | The evidence-backed `runtime-box-production-report.md` records the supported matrix, reviewed run IDs, protected environments, variable and secret names, workflows, WIF principals, service accounts, resource ownership, commands, stop conditions, and incident procedures without secret values. Runtime Box, signer, Registry, compatibility, AI roadmap, readiness, and handoff docs are aligned. Local closure gates passed: catalog `3` models / `3` fixtures, signer `11/11`, verify profile `164/164` plus all builds/checks, and the internal docs build |

## Completed foundation

### Gate 0: target identity

Canonical target IDs are enforced by the shared core contract, Node tooling,
Rust, the Registry Worker, and the Cloud Run signer. Invalid target identity is
rejected before download, archive creation, signing, publication, or routing.
`runtime-boxes/target-id-contract.json` is the cross-language target table.

### Gate 1: native builder adapters

`scripts/runtime-box/targets.mjs` owns macOS arm64, Linux x86_64, and Windows
x86_64 build adapters. Shared signing, hashing, archive identity, and publication
remain platform-independent. Native builds use relocatable standalone Python,
safe deterministic archives, and reject leaked build-host paths.

### Gate 2: synthetic native foundation

Stdlib-only Linux and Windows fixtures prove deterministic build, signing,
verification, self-test, resume, archive safety, rebuild, and Rust lifecycle
behavior. The Linux T4 preflight passed in run `29379447099`; the Windows T4
preflight passed in run `29381770492`. The Windows timeout is 60 minutes because
a cold Rust/Tauri build can exceed 30 minutes while still progressing.

### Gate 3: host selection and provenance

`packages/liatir-core` owns ordered target candidates and activation provenance.
The installer selects a target per installation using host RAM, platform, and
NVIDIA driver facts. Linux and Windows fall back from CUDA to CPU when required;
Windows is never routed to WSL2. Exact signed release envelopes flow into Jobs,
Results, and persisted model state.

### Gate 4: workflow topology

Reusable validation, per-model callers, foundation fixtures, Linux and Windows
CUDA preflights, protected release, and signer deployment workflows are wired.
Model callers perform catalog preflight without enabling native model validation
by default. The last recorded catalog-only workflow runs were:

- scGPT Whole-human: `29421879649`
- Geneformer V1 10M: `29421877045`
- UCE 4-layer: `29421877067`

### Gate 5: identities and protected publication

The `runtime-box-production` and `runtime-box-signer-admin` GitHub environments
are restricted to `main`. Separate Google Workload Identity Federation
providers map exact workflow, ref, and environment claims to separate service
accounts. Release CI can invoke the signer but has no KMS authority. Registry
publication is authenticated and content-addressed, so release CI does not hold
a broad Cloudflare or R2 token.

### Gate 6: evidence contract

The core package owns compact evidence for source and workflow identity, host
and peak disk, build and self-test, scientific validation, publication, and
promotion. CI uploads only credential-free JSON evidence with short retention;
model assets and Runtime Box archives are never uploaded as Actions artifacts.
Accepted production evidence is reviewed and committed under
`runtime-boxes/evidence/` before the catalog references it.

### Gate 7: cost and trigger controls

GPU workflows are manual-only. Validation is limited to one model and target,
foundation jobs use `max-parallel: 1`, and production releases share a queue
that is never cancelled. Exact dependency-lock hashes and calculated peak disk
budgets are checked on standard runners before native allocation. Long-running
commands use concise five-minute heartbeat output. Gate 7 passed the catalog,
core, foundation lifecycle, workflow YAML, and root verification suites without
starting a GitHub Actions run.

## Gate 8: first end-to-end pilot

Geneformer V1 10M is the pilot because it is already lawfully integrated and
published on macOS arm64, its current archive is relatively small, and an exact
pinned CPU parity fixture already exists. Execute Gate 8 strictly through the
following three sub-gates.

### Gate 8.1: Geneformer Linux pilot

1. Recheck current official source, license, checkpoint, dependency lock,
   artifact layout, and hardware requirements.
2. Build and scientifically validate `linux-x86_64-cpu`.
3. Only after CPU succeeds, build and validate `linux-x86_64-cuda12.4` using
   the pinned CPU baseline, T4 inference, and recorded tolerances.
4. Complete protected beta publication and targeted Linux install,
   product-runner, Jobs, Results, provenance, replacement/removal, and cleanup
   evidence for each newly validated target.

Exit only when Linux artifacts, KMS signatures, immutable R2 objects, channel
metadata, scientific evidence, product lifecycle, and cleanup are verified.

#### Gate 8.1 execution record

Current state as of 2026-07-18:

- The official source, license and redistribution record, exact checkpoint,
  dependency lock, artifact layout, CPU/CUDA requirements, and T4 compatibility
  were rechecked before execution. The repository pins source revision
  `04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5`, checkpoint SHA-256
  `a5e33a757431643b3697de7ef6127950cdc49e06e58d4266b3a3ab191b683f14`,
  Linux CPU dependency-lock SHA-256
  `73a31b39b7f2f3eee6a1c7628d13728490ed4db31095c50ab5ce0211b98829f1`,
  and Linux CUDA dependency-lock SHA-256
  `4cc737f7bb6580de2fc6da0d89f2a17a2f200a35c82f5734f7e503c1772579ed`.
- The protected signer path passed in run `29536134188`. GitHub deploys the
  Cloud Run signer but has no direct Cloud KMS role; the signer runtime identity
  remains the only KMS signing principal.
- `linux-x86_64-cpu` build, archive verification, self-test, KMS signing,
  immutable candidate publication, and pinned scientific parity have passed in
  the latest attempts. The fixed `4 x 128` fixture produced `4 x 256`
  embeddings with maximum absolute error `0` and minimum cosine similarity
  `1.0` against the CPU baseline.
- Run `29546883054` passed product install, interrupted resume, real inference,
  Jobs, Results, provenance, replacement, rollback, removal, result persistence,
  cleanup, and beta promotion. Artifact `8394509427` preserves the passing
  product lifecycle receipt with analysis run
  `52f23da1-4d22-4b6e-ac83-191b1431bbb9` and three Result artifacts.
- Run `29546883054` failed only while
  assembling the final signed release evidence because kebab-case workflow flags
  such as `--publish-receipt` were not converted to the evidence API's camelCase
  keys. Commit `2a72330` fixes that single CLI boundary and its focused local gate
  passed 21/21 tests plus the catalog and syntax checks.
- `linux-x86_64-cpu` is **complete** in run `29547725429` at commit `3031029`.
  Artifact `8394807365` (digest
  `sha256:e9945cef5481a15755e9b1005974da88b0cd9f558af188ad7d18a968cc2783da`)
  contains complete release, product lifecycle, and E2E evidence. The reviewed
  evidence is tracked at
  `runtime-boxes/evidence/geneformer-v1-10m-linux-x86_64-cpu-1.0.0-beta.1.json`.
  The public beta channel, 2,467-byte release manifest, and 380,481,131-byte
  archive all returned HTTP 200 after promotion. The archive SHA-256 is
  `a95a1a403bff74cf2af6c1b3f96cecace1201364ff94eec621ca90b80bf5a95b`.
- Commit `3766d41` corrects the last observed WebDriver readiness race. Its local
  gate passed 8 focused unit tests, syntax checks, a clean product build, and
  three separate cold native-app starts with 6/6 bridge assertions passing.
- Only after the CPU lifecycle closed, preparation started for
  `linux-x86_64-cuda12.4`. The checked recipe uses Python 3.11.9, uv 0.11.28,
  PyTorch 2.4.1+cu124, CUDA 12.4, NVIDIA driver 550.54.14 or newer, and an exact
  Tesla T4 profile with compute capability 7.5 and at least 15,000,000,000 bytes
  of usable GPU memory. The 47-wheel lock has a 2,984,892,298-byte compressed
  set and a 5,443,678,121-byte expanded set; the legal audit retains the license
  and notice files for all packages, including the 12 NVIDIA distributions.
  Because four wheel metadata directories omit a bundled license file, the
  payload also carries the shared Apache 2.0 text for the two Apache packages
  and exact, hash-pinned MIT notices for array-api-compat 1.15.0 and Triton
  3.0.0.
- Signer deployment run `29641886027` passed at commit `7ed0f87` after explicit
  authorization. It preserved the release-CI boundary: GitHub can invoke the
  private signer, while only the Cloud Run runtime identity can use Cloud KMS.
- The first paid CUDA release attempt, run `29642025139` at commit `7ed0f87`,
  passed protected-input resolution, the exact T4 host/storage probe, setup, and
  installation of all 47 hash-locked packages. It then stopped before signing,
  publication, or promotion because uv 0.11.28 used its documented three-line
  POSIX shell trampoline for console scripts whose absolute interpreter path
  exceeded 127 bytes. The relocatability repair inspected only the first line,
  so it correctly rejected the remaining build path but could not repair it.
  Cleanup and compact failure-evidence upload passed. Artifact `8428926086`
  preserves the 653-byte failure receipt with digest
  `sha256:26dc047ee274a14d933fdc97ff5361ed96ec12d7b6555144b19da14ea9d8c50b`.
  A regression fixture now reproduces that exact uv launcher form; the generic
  repair strips either a direct shebang or the three-line trampoline before
  installing Liatir's relative launcher, and all 61 Runtime Box unit tests pass
  locally.
- Corrected CUDA run `29642529231` at commit `1dfa7c0` passed the exact T4 host
  gate, reproducible build, KMS signature, archive verification, native
  self-test, scientific validation, immutable publication, and a real product
  build. The 3,079,059,631-byte archive has SHA-256
  `60bcbec2144456e1f7ea91454db00b7e90bb4942927f400acc380b9ea8ca37d4`
  and expands to 5,567,128,470 bytes. Real T4 inference used driver 590.48.01,
  compute capability 7.5, and 106,767,872 peak VRAM bytes. Against the pinned
  same-lock CPU baseline, maximum absolute difference was
  `0.0000010654330253601074` and minimum cosine similarity was `1.0`, within
  the fixed tolerances.
- Run `29642529231` then failed before product installation completed because
  the native lifecycle fixture imposed one fixed 180-second bound inherited
  from the 380 MB CPU box. The CUDA archive is 3.08 GB and the app remained
  alive and installing when the fixture timed out; the test did not record the
  final progress snapshot, so this remains a failed lifecycle gate rather than
  a completed install. Beta promotion was skipped, while candidate-registry
  shutdown and build cleanup passed. Artifact `8429189899` preserves the
  3,076-byte failure evidence with digest
  `sha256:b4f9ac4dcab2d4933c1573a9c5bf4f802add18d57fd743a79dd14d148c9669f1`.
- Commit `2134b3c` replaces both fixed install/replacement waits with one
  target-independent bound derived from the archive byte total observed in the
  real product progress stream. The 3,079,059,631-byte CUDA archive receives a
  547,053-millisecond bound using a conservative 8 MiB/s transfer floor plus
  fixed verification, extraction, self-test, and activation allowance. Timeout
  failures now include the wait error, install error, event count, downloaded
  and total bytes, and latest progress event. The regression failed before the
  helper existed; afterward all 63 Runtime Box tests and the full 6-suite,
  143-test verification profile passed locally.
- Lock reproducibility was rechecked independently with the verified uv 0.11.28
  binary and live indexes: the resolver selected the same 47 packages and
  reproduced dependency-lock SHA-256
  `4cc737f7bb6580de2fc6da0d89f2a17a2f200a35c82f5734f7e503c1772579ed`.
- Final CUDA run `29643382673` at commit `5c96bea` passed every protected release
  step on `liatir-linux-t4`: exact host/storage preflight, reproducible build,
  private KMS signing, archive verification, self-test, pinned scientific
  parity, immutable publication, real product build and install, interrupted
  resume, real inference, Jobs, Results, provenance, replacement, rollback,
  removal, result persistence, beta promotion, evidence upload, registry
  shutdown, and cleanup. The product lifecycle receipt records Job `job_1`,
  analysis run `d22ebaea-3d2c-4996-b346-7c067f4cb01b`, and three Result
  artifacts with every assertion passed.
- The final Tesla T4 host used driver 590.48.01, compute capability 7.5, and
  CUDA 12.4. Peak VRAM was 106,767,872 bytes. The `4 x 256` output was finite;
  maximum absolute difference from the pinned same-lock CPU baseline was
  `0.0000010654330253601074` and minimum cosine similarity was `1.0`, within
  the fixed tolerances.
- Artifact `8429493437` (digest
  `sha256:228c5bd72c68ce6589079c0b0da0d6e27f0d12d0104e5c392f7f3a7eb5ecbef1`)
  contains the final release, product lifecycle, and E2E evidence. The reviewed
  evidence is tracked at
  `runtime-boxes/evidence/geneformer-v1-10m-linux-x86_64-cuda12.4-1.0.0-beta.1.json`.
  The immutable 3,079,059,631-byte archive has SHA-256
  `e991644d230d3d86c9c3cdd2c5bf8473c028b5fd8b09a83ba0b005736b66e544`
  and expands to 5,567,128,470 bytes. The 2,575-byte release manifest has
  SHA-256 `4d61626492d409fb155c3d6c12e15c7a9de0cc1e062476b1f8931c6d3bc80e56`.
  The public archive, release manifest, and signed beta channel were checked
  after promotion; they return the exact final target and hashes.
- Commit `07c6c69` records the reviewed evidence, marks the CUDA target
  published in the checked catalog, and exposes it from the shared
  `packages/liatir-core` product contract with minimum NVIDIA driver 550.54.14.
  The final local gate passed catalog validation, signer checks (10/10), the
  focused target/catalog tests (19/19), and the root verification profile
  (6/6 suites, 143/143 unit and contract tests, SDK generation, core build,
  Svelte check, frontend production build, and root TypeScript compilation).
- Gate 8.1 is **complete** with no unresolved Linux CPU or CUDA evidence gap.
  Gate 8.2 and every later gate remain not started.

Incident ledger:

| Run | Result | Observed blocker or verification | Corrective commit |
|---|---|---|---|
| `29531614363` | Failed | Signer deployment crossed into manual-only KMS inspection | `e14645c` |
| `29535230731` | Failed | Cloud Build signer build identity was not pinned explicitly | `f5d232b` |
| `29535712126` | Failed | Signer smoke test lacked its short-lived service identity token | `0d94ee6` |
| `29536134188` | Passed | Protected signer deployment and live signing verification completed | — |
| `29536320468` | Failed | Clean Linux builder did not install the pinned standalone Python first | `52ef2b9` |
| `29536831378` | Failed | Relocatable Python retained unnecessary build tooling | `3091de2` |
| `29537269267` | Failed | Release publication lacked the signer identity token | `8f70c3e` |
| `29537705732` | Failed | CI attempted to parse JSON from a successful silent validator | `c012bc5` |
| `29538153057` | Failed | Clean product evidence preparation was incomplete | `9252da9` |
| `29538835560` | Failed | Clean product build had no installed frontend dependencies | `f1fa230` |
| `29539350276` | Failed | Clean product build had no repository-pinned Tauri CLI | `76b9b7c` |
| `29540992199` | Failed | Product lifecycle E2E startup/session handling was not robust enough | `794d2ac` |
| `29542218213` | Failed | Optional Linux desktop integration failure terminated the app | `f32188e` |
| `29542962600` | Failed | Interrupted-download cancellation was nondeterministic | `607bbdb` |
| `29544128885` | Failed | `minRamGb` was documented as decimal GB but compared as GiB | `5fcbbb3` |
| `29544965106` | Failed | HTTP 200 from `/status` was mistaken for WebDriver readiness during initial WebKit navigation | `3766d41` |
| `29546883054` | Failed | Full product lifecycle and beta promotion passed; final evidence CLI lost kebab-case receipt flags | `2a72330` |
| `29547725429` | Passed | Linux CPU build, parity, protected publication, product lifecycle, final evidence, and cleanup completed | — |
| Local CUDA preparation | Corrected | Prior Runtime Box temporary build and audit directories left only 6.3 GiB free; removed known generated temporary state and restored 13 GiB before lock and license work | `113bec7` |
| Local CUDA license audit | Corrected | The first exact-wheel download omitted the `linux_x86_64` platform tag used by the official PyTorch cu124 wheel; the corrected multi-tag download verified all 47 wheel hashes before metadata extraction | `113bec7` |
| Local documentation review | Corrected | A draft roadmap line contained a mistyped checkpoint digest; direct comparison with the content-addressed recipe corrected it before commit or remote execution | `113bec7` |
| Local release-workflow review | Corrected | The early paid-host probe ran before the workflow pinned Node 22; setup-node now precedes the dependency-free probe while authentication and downloads remain afterward | `113bec7` |
| Local scientific-validator review | Corrected | The Metal compatibility branch compared arrays before rejecting a shape mismatch; shape validation now runs first, avoiding invalid broadcasting or an opaque NumPy error | `113bec7` |
| Local CUDA evidence-contract review | Corrected | Draft evidence assembly discarded product GPU details and the generic validator did not require same-lock CPU-baseline, CUDA identity, compute capability, or peak-VRAM proof; the shared core and evidence validator now preserve and enforce those fields | `113bec7` |
| Local lock reproduction | Corrected | The first regeneration attempt could not resolve PyPI because sandbox DNS was disabled; the same pinned command ran once with network access and reproduced all 47 packages and the exact lock hash | `113bec7` |
| Local full-unit gate | Corrected | The product core correctly exposed the published Linux CPU target, but the Batch 5 Geneformer contract test still expected macOS only; the test now asserts both published targets and the matching host requirements | `113bec7` |
| Local redistribution review | Corrected | Four exact wheels declare a license but omit a license file from `.dist-info`; Apache components are covered by the named inventory and shared Apache text, while exact upstream MIT texts and copyright notices were added for array-api-compat 1.15.0 and Triton 3.0.0 | `113bec7` |
| Local source-hash check | Limited | The environment rejected a redundant streamed comparison after the official tagged LICENSE contents had already been read; the reviewed contents are stored locally and their local SHA-256 values are pinned in the recipe | `113bec7` |
| Signer dispatch | Blocked before run | The local approval layer reported an exhausted Codex usage limit and rejected the GitHub API command before workflow creation; observed remote cost is USD 0 and an explicit post-notice authorization is required | — |
| `29641886027` | Passed | Protected signer deployment and live signing verification completed on the current main revision | — |
| `29642025139` | Failed | uv 0.11.28 emitted a three-line POSIX trampoline after the CUDA recipe path crossed the 127-byte shebang limit; the relocatability repair checked only its first line, then rejected the absolute path before signing or publication | `c30e423` |
| `29642529231` | Failed | Build, signing, self-test, T4 parity, immutable publication, and product build passed; the native lifecycle fixture retained a fixed 180-second install bound from the 380 MB CPU target and timed out while installing the 3.08 GB CUDA archive | `2134b3c` |
| `29643382673` | Passed | Linux CUDA build, T4 parity, protected publication, complete product lifecycle, final evidence, beta promotion, and cleanup completed | `07c6c69` |

The earlier release attempts consumed about 114 minutes of observed workflow
wall time and the first four signer attempts consumed about 6 minutes. At the
standard Linux rate of USD 0.006/minute this is approximately USD 0.72 before
job-minute rounding. Signer run `29641886027` added 1 minute 47 seconds of run
wall time. CUDA run `29642025139` used about 1 minute 39 seconds of the T4 job
plus a short standard preflight; at the declared runner rates its incremental
Actions exposure is approximately USD 0.10 before rounding. GitHub and Google
Cloud billing remain the authoritative cost records. Corrected CUDA run
`29642529231` added about 17 minutes 4 seconds on the T4 job plus a 22-second
standard preflight, approximately USD 0.94 at the declared runner rates before
rounding. Final CUDA run `29643382673` added 23 minutes 29 seconds on the T4 job
plus a 19-second standard preflight, approximately USD 1.29 at the declared
runner rates before rounding. The documented Gate 8.1 Actions exposure is
therefore approximately USD 3.06 in total, including the earlier CPU/signer
attempts and the three CUDA attempts. GitHub Actions, Cloud Build, Cloud Run,
and Cloud KMS billing remain authoritative; Codex subscription-credit usage is
not available as a repository-verifiable measurement. Gate 8.1 requires no
further paid run.

### Gate 8.2: Geneformer Windows pilot

Start only after Gate 8.1 is complete and the Linux CUDA evidence satisfies the
Windows prerequisite.

1. Build and scientifically validate `windows-x86_64-cpu`.
2. Only after CPU succeeds, build and validate
   `windows-x86_64-cuda12.4` using the pinned CPU baseline and native Windows T4
   inference.
3. Complete protected beta publication and native Windows install,
   product-runner, Jobs, Results, provenance, replacement/removal, and cleanup
   evidence for each target.

Exit only when native Python and DLL loading, archive/self-test, KMS signatures,
immutable R2 objects, channel metadata, scientific evidence, product lifecycle,
and cleanup are verified.

**Re-scope (2026-07-21): step 2 (`windows-x86_64-cuda12.4`) is deferred and out
of Gate 8 scope.** The GitHub-hosted Windows T4 runner ships NVIDIA driver
`471.11` (R470), which cannot run CUDA 12.4 (needs R525+ / R551.61); the
host-probe rejects it in about a minute before any paid build. This is a runner
limitation, not a product or code gap. The recipe, dependency lock, license
audit, catalog target, signer policy, and workflow wiring are built, reviewed,
and committed, and the catalog target stays `buildable` — never `published` — so
no unvalidated box can ship. **Windows CUDA is therefore not a supported target
and must not block Gate 8.3, Gate 9, or Gate 10.** It re-enters scope only when
the Windows GPU runner offers R525+, a self-hosted R525+ Windows runner is
added, or a separate `windows-x86_64-cuda11.8` target is approved. Gate 8.2 is
otherwise closed on `windows-x86_64-cpu`.

#### Gate 8.2 execution record

Current state as of 2026-07-18:

- The official Geneformer repository still identifies revision
  `04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5` and Apache-2.0 terms. Fresh
  downloads of the pinned configuration, checkpoint, token dictionary, median
  dictionary, and Ensembl mapping reproduce every recipe size and SHA-256.
- Official uv documentation still exposes the `x86_64-pc-windows-msvc` target
  and managed python-build-standalone runtimes. Official PyTorch indexes still
  publish CPython 3.11 Windows x86-64 wheels for `torch==2.4.1+cpu` and
  `torch==2.4.1+cu124`.
- NVIDIA's CUDA 12.4 release notes require Windows driver `551.61` for the CUDA
  12.4 GA toolchain. The planned T4 runner remains compatible at compute
  capability 7.5 and 16 GB VRAM; the looser CUDA 12.x minor-compatibility floor
  is not used as the target contract.
- `windows-x86_64-cpu` now has an exact Python 3.11.9/uv 0.11.28 recipe and a
  reproducible 35-package lock. Two independent resolutions produced SHA-256
  `b0e070dbcbf7c236db06afd086bd39dec99721221f0019ce12f9cb1affd28e7c`
  and selected exactly `torch==2.4.1+cpu`.
- A local non-executing foreign-wheel audit verified all selected hashes and
  Windows wheel identities. The dependency payload measures 306,063,118 bytes
  compressed and 1,484,068,521 bytes expanded. The reviewed inventory is in
  `runtime-boxes/legal/audits/geneformer-v1-10m-windows-x86_64-cpu.json`.
- The Windows CPU recipe includes the exact upstream MIT notice for
  `array-api-compat==1.15.0`, whose wheel declares MIT but contains no license
  file. The existing supplemental notice is now an explicit self-test input.
- Protected signer deployment run `29649289028` succeeded from clean `main` at
  `618fd21`. Source/policy validation, private Cloud Run deployment, a live KMS
  smoke test against the app trust root, and compact deployment evidence all
  completed successfully.
- The first Windows CPU release run `29649411609` stopped in the initial host
  probe, before release authentication, dependency setup, signing, publication,
  or product execution. Git for Windows had checked out byte-pinned
  `requirements.lock` files with CRLF because their `eol` attribute was
  unspecified, so the catalog correctly rejected the first lock hash.
- A repository-wide Git attribute now forces LF for every Runtime Box
  `requirements.lock`. A red regression first reproduced `eol: unspecified` for
  the catalog recipes; it now verifies `eol: lf` for every fixture and model
  lock.
- The next run `29649766313` passed the lock checks and then stopped on the first
  byte-pinned local legal file, which Git for Windows had also converted to
  CRLF. The regression and checkout policy now cover every recipe-declared local
  input: text inputs must be forced to LF, while any future binary input must be
  explicitly marked non-text. Catalog validation passes without a target-specific
  hash bypass or CI-only fallback.
- Run `29650191000` passed the complete host/catalog/disk probe and all Windows
  setup, then failed immediately when Node attempted to spawn `npm.cmd` without
  a shell. The same unsafe invocation existed in build, scientific validation,
  and product lifecycle paths. A shared Runtime Box process helper now invokes
  `npm-cli.js` through the current Node executable on Windows, retaining a
  shell-free argument boundary for all three paths. Focused regression coverage
  rejects command-shim use and verifies both npm-path resolution modes.
- Run `29650639895` proved the corrected host probe and npm invocation, installed
  the pinned standalone Python and all 35 locked CPU dependencies, then stopped
  at the relocatability gate. uv-generated Windows PE console launchers embedded
  the build interpreter's absolute path because the copied standalone runtime
  was not marked relocatable during wheel installation. The gate rejected ten
  affected launchers before assets, signing, publication, or product execution.
- Official uv 0.11.28 source confirms that its wheel installer reads
  `relocatable = true` from the environment's temporary `pyvenv.cfg`, computes
  the interpreter relative to the scripts directory, and emits Windows PE
  launchers with native relative-path support. The Runtime Box payload must not
  retain that temporary virtual-environment marker because the final artifact is
  a complete standalone Python distribution, not a host-dependent venv.
- The stdlib-only Windows foundation fixture could not expose this defect because
  it generated no package console entry point. The corrective regression now
  installs a deterministic local wheel with a console command, relocates the
  complete payload, and executes that command on the native target.
- The corrective unit regression first failed on the old Windows launcher
  contract and missing install helper, then passed after the generic fix. The
  expanded macOS native fixture also completed two deterministic builds, local
  signing and verification, locked-wheel hash rejection, console-launcher
  relocation and execution, download resume, and cleanup with uv 0.11.28. This
  was the final local gate before the subsequent Windows PE proof.
- Protected Windows CPU release run `29651651212` ran from clean fix commit
  `46d2ca1`. It proved the corrected PE launchers: build and locked dependency
  installation completed, KMS signing succeeded, and the signed native self-test
  passed. Scientific validation then failed before publication because the
  validator's blobless Git checkout could not demand-fetch the exact tokenizer
  blob on Windows. Publication, product build/lifecycle, and promotion were
  skipped, final failure evidence was uploaded, and build state was cleaned.
- The exact tokenizer remains available from the immutable upstream revision:
  34,686 bytes, Git blob `8af0cfa0f336d007feb2b144129a96c88ad8a871`,
  and SHA-256
  `689b71a916b75fa618fbb460a7fc460c3ab32d41e4f98064efb0ebb3ee921002`.
  The validator now downloads that one file through the shared resumable,
  size-and-hash-verifying asset path instead of relying on a partial-clone
  promisor remote. A red regression first reproduced the old implementation,
  and the exact Node download path passed locally against the official URL with
  immediate temporary-file cleanup.
- Windows CPU is not validated or channel-promoted, and Windows CUDA has not
  started.
- Corrected Windows CPU release run `29652046517` was dispatched from clean
  commit `846ce1a`. Build, KMS signing, native self-test, scientific parity, and
  immutable publication plus public hash verification passed. The subsequent
  real-product build failed when `scripts/build-browser-api.mjs` directly
  spawned `npx.cmd`, which Node 22 rejected with `EINVAL` on Windows. Product
  lifecycle and channel promotion were skipped; compact failure evidence was
  uploaded and build state was cleaned. The content-addressed candidate remains
  unpromoted and must not be presented as the validated beta target.
- The follow-up correction centralizes shell-free Node CLI invocation for
  repository build and test child processes. On Windows, npm runs through the
  resolved `npm-cli.js`; local TypeScript and Tauri CLIs run through their exact
  JavaScript entry points and the current Node executable on every platform.
  The regression was first red against the direct shim call and now passes.
  The previously failing browser API build, the full root verification profile,
  and the complete local Tauri preparation/build all pass with the correction.
- Run `29652909939` was incorrectly dispatched from clean corrective commit
  `f2b5c75` through the per-model validation workflow instead of the protected
  production release workflow. It passed Windows build, signed self-test, and
  scientific validation, then was cancelled during the Rust lifecycle step to
  stop further cost. It did not use KMS, publish, run the product lifecycle, or
  promote a channel and therefore provides no release completion evidence.
  Windows CUDA remains blocked until every CPU release requirement passes.
- Protected Windows CPU release run `29653929900` was dispatched through exact
  workflow `Runtime Box production release` from revision
  `bc71b13abe34f10fbd16f065a670caab09f4e9f1` with model
  `ctheodoris-geneformer-v1-10m`, target `windows-x86_64-cpu`, and channel
  `beta`. The immediate readback confirmed the workflow, revision, manual event,
  and `Resolve protected release inputs` preflight. The protected preflight,
  Windows host/storage gate, KMS-signed build, signed self-test, scientific
  parity, immutable publication and public hash verification, and real product
  binary build all passed. The app then exited with Rust code 101 before the
  embedded WebDriver became ready, so Jobs, Results, provenance,
  replacement/removal, cleanup assertions, and beta promotion did not run.
  Artifact `8432472551` contains the compact failed release evidence; no product
  report was created by the old runner. The content-addressed candidate remains
  unpromoted.
- The failure exposed a generic diagnostic defect in the E2E runner: native
  stdout and stderr were piped to one stream that either source could close, the
  stream was not awaited during cleanup, and startup exceptions bypassed report
  generation and the existing per-test log-tail path. A red regression first
  reproduced the absent startup diagnostic. The corrected runner keeps both
  pipes open until bounded process cleanup, enables a Rust backtrace, flushes
  the native log, prints one bounded tail, and persists the same tail plus a
  synthetic `Native app startup` failure in the compact E2E report.
- A manual-only `Runtime Box Windows product startup smoke` now isolates the
  unresolved native startup from model build, KMS, publication, and promotion.
  It builds the real product on one `windows-2025` runner and starts the exact
  embedded-WebDriver path with a 40-minute hard timeout. It exists to acquire
  the missing panic once before a corrected production release, not as a
  generic CI trigger. The diagnostic implementation and red regression were
  committed and pushed as `2828111` with generic push CI skipped.
- Startup smoke `29655341658` was dispatched once from exact `main` revision
  `5732648a0cfedc101a7a34544cd03d3f8bbb9653`. Immediate readback confirmed
  workflow `Runtime Box Windows product startup smoke`, manual event, the exact
  revision, and the sole `Build and start the real Windows product` job. Its
  maximum standard-runner exposure is USD 0.40 under the 40-minute timeout; no
  GPU, model build, KMS, publication, or promotion was part of this run. The
  real product build passed, startup failed in approximately three seconds, and
  the corrected diagnostic report preserved the full native panic.
- The report identifies the exact root cause: the E2E environment replaced
  `USERPROFILE`, `APPDATA`, and `LOCALAPPDATA` with per-run Windows paths but
  created only the parent test home. Windows Known Folder resolution verifies
  the declared AppData paths, returned `UnknownPath`, and caused built-in plugin
  storage and IPC initialization to fail before `EnvState::init` panicked at
  `src/main.rs:142`. This is not a WebView2, global-shortcut, or model failure.
- The generic correction keeps per-run isolation and creates every directory
  declared by the native-app environment before spawning Liatir. It does not
  weaken production startup, bypass code under `LIATIR_TEST_MODE`, or fall back
  to the host profile. A red Windows-path regression first failed because no
  preparation helper existed; it now verifies the exact directories and both
  focused diagnostic suites pass. The correction was committed and pushed as
  `a29ee24` with generic push CI skipped.
- Corrected startup smoke `29655881672` was dispatched from exact `main`
  revision `c3e768b8664b7f90ccee920a0dbf8c16b90d41dc`. Immediate readback
  confirmed the manual startup workflow, exact revision, and sole Windows
  product job. The real build passed, Liatir remained alive, the embedded
  WebDriver became ready, a session was created, and the product spec began.
  This proves the AppData correction. The first asynchronous app command then
  timed out during initial WebView navigation; no Runtime Box download or
  production release retry started.
- The second smoke also exposed a scope error: the diagnostic workflow selected
  the complete Runtime Box lifecycle spec instead of a bridge-only startup
  spec. It failed before the install call, so no model state changed, but the
  action definition was broader than intended. Red regressions now reject that
  spec and reject a bridge injected into transient `about:blank` as app-ready.
  The workflow uses the existing native bridge/storage smoke, and shared app
  readiness now requires the real document navigation to be complete. Native
  bridge path assertions are normalized for Windows without changing paths
  passed to the product. The scoped correction was committed and pushed as
  `507c575` with generic push CI skipped.
- The checked release resolver selects `windows-2025`, a 90-minute timeout,
  5,412,219,713 calculated peak bytes, and a 6 GiB hard disk gate. The release
  workflow now resolves `dumpbin.exe`, uses the recipe-owned Python entry point,
  isolates Windows AppData, and keeps the candidate Registry and product E2E in
  one bounded process tree.
- All pre-run local gates pass: catalog validation; signer policy 11/11; shared
  archive foundation; the expanded native launcher fixture; the focused
  Windows/catalog/product regressions; workflow YAML parsing; and the root
  verification profile with 28 suites and 156/156 unit and contract tests, SDK
  generation, core build, Svelte check, frontend production build, and root
  TypeScript compilation. The official `test:tauri:prepare` path also completed,
  including the local Tauri CLI JavaScript entry point and native app bundle.
- Final bridge-only startup smoke `29656573972` was dispatched from exact
  `main` revision `c310214d29b4dc2c3f5005b74536ae83e8e76cc4`. Immediate
  readback confirmed the manual startup workflow, sole `windows-2025` product
  job, and intended revision. The run passed in 14 minutes 39 seconds: the real
  product built, stayed alive, reached embedded WebDriver readiness, and passed
  both native bridge/storage tests in 5.279 seconds. Compact artifact
  `8433177679` records 2/2 passed tests, zero failures, the isolated app storage
  root, and real workspace-store access. Its Actions exposure is approximately
  USD 0.15 after per-minute rounding. It did not build, download, sign, publish,
  install, promote, or remove a Runtime Box.
- The single protected Windows CPU release retry is run `29657385347`,
  dispatched from exact `main` revision
  `85aa7f75358b17f200ae319428420eca8303a9c5` with model
  `ctheodoris-geneformer-v1-10m`, target `windows-x86_64-cpu`, and channel
  `beta`. Immediate readback confirmed workflow `Runtime Box production
  release`, the intended manual event, revision, and protected preflight. The
  complete preflight passed. On `windows-2025`, host/storage checks, cloud auth,
  locked setup, exact-revision enforcement, reproducible build with private KMS
  signing, signed native self-test, scientific validation, immutable
  publication, public hash verification, and the real product build all passed.
  The product lifecycle then failed before installation when
  `activateCleanSandbox` timed out while directly mutating private workspace
  files through `lia_app_write_text`. Beta promotion was correctly skipped,
  complete failure evidence was uploaded as artifact `8433470660`, and runner
  cleanup passed. The immutable candidate remains unpromoted.
- The release failure was reproduced locally by a red behavioral regression
  that rejects direct private app-state mutation with the exact `Script
  execution timed out` error. The generic correction delegates Sandbox
  creation and activation to the product-owned workspace flow already proven by
  the final Windows smoke. The focused regression now passes, as do catalog
  validation, signer policy 11/11, `git diff --check`, and the complete root
  verification profile with 28 suites and 157/157 tests plus every build/check
  phase. No Windows CUDA work has started.
- Final post-fix Windows CPU proof `29658451796` was dispatched from exact
  `main` revision `1caa1454c73f69a2ea02a42387662800af11b070` with model
  `ctheodoris-geneformer-v1-10m`, target `windows-x86_64-cpu`, and channel
  `beta`. Immediate readback confirmed the production release workflow, manual
  event, intended revision, and protected preflight; the exact-main check
  passed. The complete build, KMS signature, native self-test, scientific
  parity, immutable publication with public hash verification, and real product
  build all passed. The corrected product-owned Sandbox flow also passed and
  the lifecycle reached interrupted-download cancellation and resumed
  installation. The resumed install then ended with status `error`; the test
  reported only the status assertion and discarded the underlying install
  error, so artifact `8433754821` cannot identify the remaining install defect.
  Beta promotion was skipped and unconditional runner cleanup passed.
- A red regression now requires the resumed-install error to be read before the
  result and included in the compact failure report. The diagnostic correction
  passes its focused suite. It does not provide the missing error retroactively,
  and the final CPU remote-attempt cap is exhausted. Windows CPU therefore
  remains incomplete and Windows CUDA has not started.
- Root-cause analysis of the failing step: run `29658451796` was the first run to
  reach a real product activation on Windows. Every earlier run failed before it
  (line endings, `npm.cmd`/`npx.cmd` spawning, PE relocatability, tokenizer
  fetch, AppData, bridge readiness, Sandbox flow), so the resumed install — the
  first full install of the E2E — was the first time `activate_runtime` renamed
  a staged box into place on Windows. That rename runs immediately after
  `run_self_test` executes the box interpreter from the staging tree, which is
  exactly when Windows can still hold a transient lock (antivirus real-time
  scanning of freshly written executables, or a just-exited child handle) and
  return ERROR_SHARING_VIOLATION (32) or ERROR_ACCESS_DENIED (5). Unix does not
  report these on rename, which is why every host and CI build passed while the
  product activation did not.
- Fix: a shared `rename_with_retry` in `managed_bins` retries a rename on
  transient Windows locks with a bounded backoff (~1.4 s worst case) and returns
  a genuinely permanent error on the first attempt. It is now used by
  `activate_runtime`, `rollback_runtime`, and the download's final `.part`
  rename, replacing the duplicated ad-hoc rename/copy logic. Cross-platform unit
  tests cover the happy path, the permanent-error path, and the Windows
  sharing-violation classifier; a `#[cfg(windows)]` regression holds a
  share-denying lock on a staged file and proves activation still completes once
  the lock releases. Local gates are green: the crate compiles, the ten existing
  `runtime_box` Rust tests (activation and rollback included) pass, and all 74
  runtime-box unit tests pass. The diagnostic capture from the prior commit
  remains in place, so if this hypothesis is wrong the next run surfaces the
  exact install error instead of discarding it. One corrected Windows CPU proof
  is the remaining evidence.
- Free Windows validation was itself blocked: the foundation Windows fixture had
  been failing since the heartbeat wrapper landed because
  `scripts/runtime-box/heartbeat.mjs` spawned `npm` shell-free, which is ENOENT
  on Windows (npm is a command shim). It never reached the wrapped
  `cargo test runtime_box` Rust-lifecycle step, so the activation fix could not
  be proven for free. The heartbeat runner now routes `npm` through the shared
  `npmInvocation` (node + `npm-cli.js`) while `cargo`/`node` pass through
  unchanged, with a focused unit regression. The production release path does not
  use the heartbeat wrapper (its Windows steps call `npm` through PowerShell), so
  this only unblocks the free foundation validation, not the paid release.
- The free foundation run `29695274321` then confirmed the heartbeat fix (macOS
  and Linux fixtures passed, and the Windows fixture cleared the `npm` ENOENT)
  but exposed a separate, pre-existing Windows regression in the native stdlib
  fixture: `scripts/validate-runtime-box-native-fixture.mjs` fails to spawn the
  relocated console launcher (`liatir-lock-fixture.exe ENOENT`). This is a Gate 2
  fixture regression that does not gate the Gate 8.2 release, so it is recorded
  for separate follow-up and was not chased here.
- Paid release run `29695852496` (exact fix revision `657a52b`) then surfaced the
  actual Gate 8.2 error, which the earlier discarded assertion had hidden:
  `Resumed Runtime Box install failed with status error: AI Runtime Box self-test
  failed with status exit code: 1`. The failure is in `run_self_test`, before
  activation is reached, so the `rename_with_retry` hypothesis was wrong (that
  fix is retained as correct defensive behavior but was not the blocker). The
  build, KMS signature, scientific parity, immutable publication, product build,
  Sandbox flow, and interrupted-download resume all passed; only the installed
  box's Python import self-test failed on Windows. The Windows and Linux CPU
  self-tests import the same modules (`torch`, `transformers`, `anndata`,
  `numpy`, `scipy`, `pandas`, `h5py`, `safetensors`) and Linux passes, so this is
  Windows-specific to the extracted/relocated box.
- `run_self_test` discarded the child's stderr (`Stdio::null`), so which import
  failed and why is not yet known. It now captures the self-test stderr and
  includes the Python traceback tail in the error (bounded), with a portable unit
  regression proving a failing import is reported by name rather than only as an
  exit code. One diagnostic Windows CPU run is required to read the exact
  traceback before a targeted fix.
- Diagnostic release run `29696802999` (revision `94d93e8`) captured the exact
  cause: `FileNotFoundError: [WinError 206] The filename or extension is too long.
  Error loading "...\.single-cell-foundation-geneformer-v1-10m.<uuid>.staging\
  venv\Lib\site-packages\torch\lib\asmjit.dll"`. This is the Windows MAX_PATH
  (260) limit, which the DLL loader still enforces. The self-test runs the box's
  interpreter from the staging directory, and the old
  `.{runtime_id}.{uuid}.staging` name added roughly ninety characters, so torch's
  nested `lib\*.dll` paths crossed 260 and every `import torch` failed with
  WinError 206. The final activated path (`ai-runtimes\{runtime_id}`) is short
  enough; only staging was over the limit. Measured against the real CI path, the
  staging path was 264 characters.
- Fix: the staging directory is now a short `.stg-{uuid}` name instead of
  `.{runtime_id}.{uuid}.staging`. Measured on the same CI path this drops the
  interpreter DLL path from 264 to 219 characters, comfortably under MAX_PATH,
  while the UUID keeps it unique. The CI E2E home is deeper than a normal user
  profile, so passing there implies production safety. The crate compiles and all
  eleven `runtime_box` Rust tests pass. A confirming Windows CPU run remains.
  Long-path awareness (manifest plus OS setting) is a possible future hardening
  but is not required now that the interpreter paths are well under the limit.
- Confirming release run `29697662905` (revision `c6eba27`) proved the MAX_PATH
  fix: install, resume, and the self-test all passed on Windows, reaching the
  first real direct Job ever run on Windows. That Job failed with `Python
  environment is not installed: single-cell-foundation-geneformer-v1-10m`. The
  cause is a second Windows-only layout mismatch: `venv_python()` resolved the
  interpreter as `venv\Scripts\python.exe` (the Liatir-managed venv layout),
  while the Runtime Box ships a relocated standalone Python whose Windows layout
  places `python.exe` at the venv root — exactly what the recipe declares
  (`pythonEntryPoint: venv/python.exe`) and what the self-test already used. On
  macOS and Linux both layouts coincide on `venv/bin/python`, so only Windows
  diverged and the earlier UCE/Geneformer direct-Job evidence there did not catch
  it.
- Fix: `venv_python` now resolves both layouts. It prefers the managed-venv path
  and falls back to the standalone `venv\python.exe` only on Windows when the
  managed path is absent, so Liatir-managed venvs (which genuinely use `Scripts\`)
  are unaffected. The resolution is factored into a pure `venv_python_for` helper
  parameterized by platform and a filesystem predicate, with a host-independent
  unit regression covering the managed, standalone, not-yet-installed, and Unix
  cases. All `python_env` and `runtime_box` Rust tests pass. One confirming
  Windows CPU run remains.
- Confirming release run `29702544175` (revision `6534f1b`) proved the
  interpreter fix: install, resume, self-test, and the start of the first real
  direct Job all worked on Windows. The Job then failed with `Script execution
  timed out`. This is the E2E harness, not the product: the WebDriver session set
  no script timeout, so the W3C default of 30 seconds applied, and the cold
  `torch`/`scipy`/`anndata` imports plus real inference on the slower Windows CPU
  runner exceeded it. macOS and Linux runners complete the same work fast enough
  to stay under 30 seconds.
- Fix: the E2E harness now raises the WebDriver script timeout after creating the
  session to the app-side Python job limit (`timeoutSeconds: 600` → 600000 ms,
  overridable via `LIATIR_E2E_SCRIPT_TIMEOUT_MS`), so the app's own timeout
  governs a slow-but-successful Job instead of a premature WebDriver abort. The
  file parses and all 74 runtime-box unit tests pass. One confirming Windows CPU
  run remains.

Active Windows CPU release checklist:

- [x] Keep `windows-x86_64-cpu` as the only active target; do not prepare or
  dispatch Windows CUDA yet.
- [x] Preserve user-owned working-tree changes and keep them outside technical
  commits.
- [x] Pass catalog validation, signer policy, focused regressions, the complete
  root verification profile, and the official local Tauri preparation path.
- [x] Read back `.github/workflows/runtime-box-release.yml` and confirm the
  protected `runtime-box-production` environment, `id-token: write`, private KMS
  signer, immutable publication, Windows product lifecycle, beta promotion,
  evidence upload, and unconditional cleanup.
- [x] Commit and push the checklist/rule update with CI skipped, then record the
  exact remote `main` revision to release.
- [x] Confirm that no `Runtime Box production release` run is queued or active.
- [x] Announce the exact runner, timeout, and maximum estimated cost.
- [x] Dispatch only `runtime-box-release.yml` from exact `main` with model
  `ctheodoris-geneformer-v1-10m`, target `windows-x86_64-cpu`, and channel
  `beta`.
- [x] Immediately verify that the created run reports workflow
  `Runtime Box production release`, the intended revision, and the protected
  release preflight. Cancel immediately on any mismatch.
- [x] After one meaningful interval, record only completion or an actionable
  failure. On failure, inspect the exact log once, add the root cause and a red
  regression, rerun all cheap gates, and allow at most one corrected retry.
- [x] Preserve run `29653929900`, artifact `8432472551`, the unpromoted state,
  and the missing-startup-report diagnostic gap in this execution record.
- [x] Add and pass a behavioral regression proving that native startup failure
  now emits one bounded diagnostic and persists a compact report.
- [x] Pass catalog, signer-policy, focused unit, YAML, and root verification
  gates with the diagnostic correction.
- [x] Commit and push the diagnostic correction from a clean technical index,
  keeping all user-owned roadmap edits unstaged.
- [x] Announce and dispatch exactly one manual-only Windows product startup
  smoke; verify its workflow, revision, runner, and startup job immediately.
- [x] Use the produced native panic to identify the root cause, add a red
  regression, apply one generic fix, and repeat all cheap gates.
- [x] Dispatch one corrected startup smoke from the exact fix revision and
  require real Windows WebDriver readiness before spending on the release.
- [x] Dispatch one final bridge-only startup smoke after all cheap gates. Stop
  paid diagnostics and do not release if this capped verification still fails.
- [x] Preserve failed release `29657385347`, artifact `8433470660`, published
  but unpromoted state, lifecycle timeout, final failure evidence, and successful
  runner cleanup in this execution record.
- [x] Reproduce the direct private-state mutation timeout with a red behavioral
  regression, replace it with the product-owned Sandbox flow, and pass all
  focused and root verification gates.
- [x] Dispatch the protected Windows CPU release allowed by the post-smoke cap;
  preserve its lifecycle failure without treating partial publication as target
  completion.
- [x] After the generic lifecycle correction and all cheap gates, dispatch the
  final protected CPU proof and stop remote execution on failure.
- [x] Classify the resumed-install failure as the first Windows product
  activation, apply `rename_with_retry` to the activation, rollback, and
  download-rename paths, and pass all cheap Rust and unit gates.
- [x] Fix the heartbeat `npm` ENOENT so the free foundation Windows fixture can
  run, then use its evidence and paid release `29695852496` to locate the real
  failure in `run_self_test` and add self-test stderr capture with a regression.
- [x] Dispatch one diagnostic Windows CPU release run to read the exact failing
  self-test import from the captured traceback; keep Windows CUDA blocked.
- [x] Identify the cause (WinError 206 MAX_PATH loading `torch\lib\asmjit.dll`
  from the long staging path) and shorten staging to `.stg-{uuid}`; pass all
  cheap Rust and unit gates.
- [x] Close Windows CPU: release run `29706828552` passed the full product
  lifecycle, beta promotion, evidence, and cleanup. Per the later 2026-07-21
  re-scope, Windows CUDA remains deferred, unpublished, unsupported, and out of
  Gate 8; do not dispatch it on the current hosted runner.

Gate 8.2 incident ledger:

| Evidence | Result | Root cause or finding | Corrective action |
|---|---|---|---|
| Local second lock | Blocked before resolution | The sandbox could not open the global uv cache | Re-ran with a gate-scoped cache under `/tmp`; no repository workaround |
| Local second lock | Blocked before resolution | Sandbox DNS could not reach the official indexes | Re-ran once with approved network access; the lock reproduced byte-for-byte |
| Local workflow syntax check | Verification command corrected | The repository does not install the optional Node `yaml` module, so the first ad-hoc parser command could not start | Used the system Ruby YAML parser once; both the new smoke and production release workflows parsed successfully without adding a dependency or changing a lockfile |
| Local macOS runner-only probe | Invalid as Gate 8.2 evidence | `test:tauri:run` was invoked against an existing binary without running the required `test:tauri:prepare` phase in the same check; the app stayed alive without a WebDriver endpoint, unlike the Windows code-101 exit | Inspected the binary and corrected the unsupported stale-binary assumption, recorded the procedural error, and did not change product code or divert the Windows gate; the paid smoke always runs the authoritative prepare script immediately before the runner |
| Root verification | Blocked in one unrelated fixture | Sandbox DNS prevented a temporary WASM conformance project from reaching `index.crates.io`; 146/147 tests had passed | Re-ran the same current repository script once with network access; all 147/147 tests and every build/check phase passed |
| Windows CPU license audit | Actionable inherited finding | `array-api-compat==1.15.0` has no wheel-bundled MIT text, and the already-published Linux CPU recipe did not add the existing supplemental notice | Windows includes and self-tests the exact notice; the pre-existing Linux publication is recorded for separate corrective replacement rather than silently changing its published recipe |
| Windows product-path audit | Fixed locally before native CI | The product E2E assumed POSIX separators in app-data assertions and constructed native paths with string concatenation | Paths now use `path.join`, and containment checks normalize separators without changing the actual path passed to the product |
| `29649289028` | Passed | Protected signer policy had to include the reviewed Windows CPU target before release | Deployed from clean `main`; live KMS signing and app trust-root verification passed |
| `29649411609` | Failed safely before build | Git for Windows converted byte-pinned lock files to CRLF because only `text=auto` applied, so the first catalog hash mismatched | Added a repository-wide LF attribute for Runtime Box locks plus a catalog-wide red regression; no authentication, build, signature, publication, or product lifecycle occurred |
| `29649766313` | Failed safely before build | After lock preservation passed, Git for Windows converted the first SHA-pinned local legal file to CRLF | Generalized the checkout policy and regression to every recipe-declared byte-pinned local input; no authentication, build, signature, publication, or product lifecycle occurred |
| `29650191000` | Failed before downloads or signing | Node on Windows rejected direct `npm.cmd` spawning with `EINVAL`; the probe and native setup had passed | Replaced every Runtime Box `npm.cmd` spawn with a shared shell-free Node plus `npm-cli.js` invocation and covered build, validator, and product lifecycle call sites |
| `29650639895` | Failed after locked dependency installation, before assets or signing | uv emitted Windows PE console launchers with absolute build-interpreter paths because the copied standalone distribution was not marked relocatable while wheels were installed; the stdlib-only native fixture generated no launcher and missed this class | Use uv's reviewed relocatable-install contract without retaining a venv marker, and extend the native fixture to relocate and execute a deterministic local console entry point before another model release run |
| Local native launcher regression | Fixed before rerun | macOS reports the canonical `/private/var/...` path for a payload created through the equivalent `/var/...` path, while the validator canonicalized only Python's value and produced a false containment failure | Canonicalize the actual destination root before comparing `sys.base_prefix` and executable containment; the stricter build-host leak scan remains unchanged |
| Local native fixture execution | Passed after environment-only retry | The restricted sandbox could neither resolve the official Python download nor bind the fixture's loopback resume server | Re-ran the identical repository command with network and loopback access; the complete native fixture passed without a repository fallback or CI-specific bypass |
| `29651651212` | Failed in scientific validation after successful build, KMS signature, and native self-test | The blobless Geneformer clone depended on Git demand-fetching tokenizer blob `8af0cfa0f336d007feb2b144129a96c88ad8a871`; the Windows checkout reported the promised object as unreadable | Replace partial Git clone with the immutable revision URL plus exact size and SHA-256 verification through the shared downloader; publication, product lifecycle, and promotion never ran |
| `29652046517` | Failed in real-product build after successful immutable publication | `scripts/build-browser-api.mjs` directly spawned `npx.cmd`; Node 22 on Windows rejected the command shim with `EINVAL`, revealing that the prior audit covered Runtime Box orchestration but not every product build helper | Audit repository-owned build/test child-process call sites, invoke JavaScript CLIs through the current Node executable, and add a focused regression before another release run; lifecycle and promotion never ran |
| `29652909939` | Cancelled during Windows Rust lifecycle after build, self-test, and scientific validation passed | The per-model validation workflow was selected by model name without reading back its action chain; it cannot authenticate to KMS, publish, execute the product lifecycle, or promote beta | Cancel the unnecessary paid validation, add the repository-wide task-specific checklist rule, and require an exact production-workflow/input/revision readback before dispatch |
| `29653929900` | Failed after immutable publication and real product build, before product lifecycle or promotion | The Windows app exited with Rust code 101 before embedded WebDriver readiness; the E2E startup path neither flushed nor emitted the native log and bypassed the compact report, so the original panic was unavailable | First fix and regress the generic diagnostic path, then run one manual-only Windows product startup smoke to obtain the panic without rebuilding or publishing the model; do not retry the release blindly |
| `29655341658` | Failed after the real product build and produced the required native report | The isolated Windows environment declared but did not create AppData directories; Tauri Known Folder resolution returned `UnknownPath`, built-in plugin storage and IPC could not resolve app data, and `EnvState::init` panicked with code 101 | Create every declared isolated directory before spawn, retain the isolation boundary, add a red regression over exact Windows paths, repeat all cheap gates, and verify one corrected startup smoke before the production release retry |
| `29655881672` | Failed after app startup, WebDriver readiness, and session creation proved the AppData fix | Shared bridge readiness accepted the injected bridge in the transient document before initial navigation settled, so the first asynchronous product command was discarded; the startup workflow also selected the full Runtime Box spec instead of a bridge-only smoke | Require a complete non-`about:blank` app document in the shared readiness helper, use the existing native bridge/storage spec, normalize its Windows path assertions, and cap paid diagnostics at one final isolated smoke |
| `29656573972` | Passed on the exact reviewed revision | Stable app navigation plus native bridge/storage behavior after all cheap gates passed | Artifact `8433177679` records 2/2 passing tests with zero failures; permit the single protected CPU release retry without any further paid diagnostic smoke |
| `29657385347` | Failed in product lifecycle after all build and publication checks passed | `activateCleanSandbox` bypassed the initialized workspace store and directly mutated its private files through a synchronous WebDriver script; Windows timed out before Runtime Box installation, while the app remained alive | Artifact `8433470660` preserves the failed lifecycle and signed release evidence; replace the private-state shortcut with the product-owned Sandbox flow, prove the exact timeout with a red regression, and repeat all cheap gates before any bounded remote proof |
| `29658451796` | Failed during resumed installation after the Sandbox correction passed | The install state ended as `error`, but the lifecycle assertion recorded only `Expected: done; Received: error` and discarded the already-held install error, preventing evidence-based root-cause classification | Artifact `8433754821` preserves the incomplete evidence; add a red regression that requires the real install error in the compact report, stop remote execution because the final cap is exhausted, and keep CPU incomplete plus CUDA blocked |
| Post-`29658451796` analysis | Root cause classified and fixed pending proof | The resumed install was the first Windows run to reach product activation; `activate_runtime` renames the staged box into place right after the self-test executes its interpreter, so a transient Windows lock (antivirus scan or just-exited child handle) can fail the rename with sharing-violation/access-denied where Unix never does | Added shared `rename_with_retry` (bounded backoff on transient locks only) to the activation, rollback, and download-rename paths; added cross-platform and `#[cfg(windows)]` regressions; passed all cheap Rust and unit gates; kept the diagnostic capture so a wrong hypothesis surfaces the exact error on the next run |
| `29695274321` (free foundation) | Windows fixture failed after the heartbeat fix let it progress | `npm` ENOENT was resolved (macOS/Linux green, Windows cleared it), but the native stdlib fixture then failed to spawn the relocated console launcher `liatir-lock-fixture.exe` (ENOENT) — a separate pre-existing Gate 2 regression, not on the Gate 8.2 release path | Recorded the fixture regression for separate follow-up; did not chase it, since the release does not run the native fixture |
| `29695852496` (paid release) | Failed in product self-test; hypothesis corrected | With the diagnostic capture in place the real error appeared: `self-test failed with status exit code: 1`, in `run_self_test` before activation — so `rename_with_retry` was not the blocker. A Windows-only Python import fails on the extracted/relocated box while the identical Linux CPU imports pass | `run_self_test` now captures and reports the self-test stderr (Python traceback), with a portable regression; dispatch one diagnostic Windows CPU run to read the exact failing import before the targeted fix |
| `29696802999` (diagnostic release) | Self-test traceback captured; root cause fixed | `[WinError 206] The filename or extension is too long` loading `torch\lib\asmjit.dll`: the `.{runtime_id}.{uuid}.staging` path (264 chars on the CI home) crossed the Windows MAX_PATH (260) the DLL loader enforces, so `import torch` failed. The final activated path was already short enough | Shortened staging to `.stg-{uuid}` (264→219 chars measured); crate compiles and all `runtime_box` tests pass; dispatch one confirming Windows CPU run |
| `29697662905` (confirming release) | MAX_PATH fixed; a second Windows-only mismatch surfaced | Install, resume, and self-test passed, reaching the first real direct Job on Windows, which failed with `Python environment is not installed`: `venv_python()` resolved `venv\Scripts\python.exe` while the standalone box ships `venv\python.exe`. Unix layouts coincide on `venv/bin/python`, so only Windows diverged | `venv_python` now resolves both layouts (prefers managed `Scripts\`, falls back to standalone `venv\python.exe` on Windows), via a pure `venv_python_for` helper with a host-independent regression; all `python_env`/`runtime_box` tests pass; dispatch one confirming Windows CPU run |
| `29702544175` (confirming release) | Interpreter fix proved; harness script timeout too short | Install, resume, self-test, and the first real direct Job all started on Windows, then failed with `Script execution timed out`: the E2E WebDriver session set no script timeout, so the W3C 30s default applied, and cold `torch`/`scipy`/`anndata` imports plus real inference on the slower Windows CPU runner exceeded it (macOS/Linux stay under 30s) | E2E harness now raises the WebDriver script timeout to the app-side 600s Python job limit (`LIATIR_E2E_SCRIPT_TIMEOUT_MS`); JS parses and all runtime-box unit tests pass; dispatch one confirming Windows CPU run |
| `29703368033` (confirming release) | Real inference passed; transient WebDriver drop | The real Geneformer Job completed and asserted a finite 256-dim embedding with the CPU accelerator, then the following UI navigation (`window.location.href = '/jobs'`) failed with `TypeError: fetch failed` while the app stayed up (`exitCode=running`): the page unload dropped the in-flight WebDriver response on the slower Windows runner | The E2E WebDriver client now retries transient connection failures (`fetch failed`/reset) with a bounded backoff, so navigation drops recover without masking real protocol errors; JS parses and structural unit tests pass; dispatch one confirming Windows CPU run |
| `29704324224` (confirming release) | Connection retry insufficient; hard reload was the cause | The same `fetch failed` recurred despite the retry, because the retry just re-triggered the hard reload; the WebDriver drop persisted longer than the bounded window | Replace the hard `window.location.href` navigation in the E2E with client-side SvelteKit anchor-click routing (no document unload, query strings preserved), confirming arrival on the actual route; dispatch one confirming Windows CPU run |
| `29705780035` (confirming release) | Navigation fixed; Result finalization missed | Client-side navigation worked (reached the `/jobs` check and the Result step), but the Job was not finalized into a Result within 60s. Removing the reload removed the incidental remount that finalized runs via `onMount`; finalization otherwise only ran while the running-job poll interval fired, so a completed direct AI run observed after it stopped was never finalized | Added a reactive `$effect` on the jobs list in the root layout that finalizes completed direct AI runs on any jobs change (idempotent, matches the finalizer's design); svelte-check clean; dispatch one confirming Windows CPU run |

Run `29651651212` used 22 seconds of standard Linux preflight and 4 minutes
18 seconds of the standard Windows runner. At the documented GitHub rates its
Actions exposure is approximately USD 0.06 after per-minute rounding. GitHub
billing remains authoritative.

Run `29652046517` used 19 seconds of standard Linux preflight and 6 minutes
1 second of the standard Windows runner. Its Actions exposure is approximately
USD 0.08 after per-minute rounding. The candidate was published by immutable
hash but not promoted to the beta channel.

Cancelled validation run `29652909939` used 24 seconds of standard Linux
preflight and approximately 17 minutes of the standard Windows runner. Its
Actions exposure is approximately USD 0.18 after per-minute rounding. It did
not perform a production release.

Failed production release `29653929900` used 15 seconds of standard Linux
preflight and 20 minutes 14 seconds of the standard Windows runner. Its Actions
exposure is approximately USD 0.22 after per-job per-minute rounding. The
immutable candidate was not promoted to beta.

Targeted startup smoke `29655341658` used 11 minutes 25 seconds of the standard
Windows runner. Its Actions exposure is approximately USD 0.12 after per-minute
rounding. It performed no model build, signing, publication, or promotion.

Corrected startup smoke `29655881672` used 14 minutes 54 seconds of the standard
Windows runner. Its Actions exposure is approximately USD 0.15 after per-minute
rounding. It performed no model download, signing, publication, or promotion.

Final bridge-only startup smoke `29656573972` used 14 minutes 39 seconds of the
standard Windows runner. Its Actions exposure is approximately USD 0.15 after
per-minute rounding. It performed no model build, download, signing,
publication, installation, promotion, or removal.

Failed production release `29657385347` used 18 seconds of standard Linux
preflight and 21 minutes 14 seconds of the standard Windows runner. Its Actions
exposure is approximately USD 0.23 after per-job per-minute rounding. The
immutable candidate was published and publicly hash-verified but not installed
through the product or promoted to beta; unconditional runner cleanup passed.

Final post-fix production release `29658451796` used 18 seconds of standard
Linux preflight and 18 minutes 55 seconds of the standard Windows runner. Its
Actions exposure is approximately USD 0.20 after per-job per-minute rounding.
The immutable candidate was published and publicly hash-verified but the
resumed product installation failed, beta promotion was skipped, and
unconditional runner cleanup passed.

### Gate 8.3: cross-platform closure

Scope note (2026-07-21): `windows-x86_64-cuda12.4` is **deferred and excluded**
from this gate — see the re-scope note under Gate 8.2. The in-scope targets are
macOS arm64 Metal, Linux CPU, Linux CUDA, and Windows CPU.

1. Run the macOS arm64 workflow regression against the published target.
   Republish only if a shared builder change requires a new release.
2. Audit the complete Geneformer evidence chain across macOS arm64, Linux CPU
   and CUDA, and Windows CPU.
3. Confirm that one real AI Model has traversed legal review, dependency lock,
   build, self-test, scientific validation, KMS signing, R2 publication, channel
   promotion, and product-runtime evidence on Linux and native Windows CPU.
4. Update catalog and readiness evidence only from produced, reviewed results,
   and state the supported matrix honestly: CUDA is validated on Linux only,
   while Windows CUDA is a built-but-unvalidated, unsupported target.

#### Gate 8.3 execution record

Pre-dispatch audit and zero-cost closure work completed on 2026-07-22 against
remote `main` revision `d07b6b4c6f0df4e7aa4e56fad3ad60ccb5193610`:

- Reviewed the complete protected-release jobs and retained artifacts for Linux
  CPU run `29547725429` (artifact `8394807365`), original Linux CUDA run
  `29643382673` (artifact `8429493437`), current-code Linux CUDA run
  `29750614689` at `2307663` (artifact `8465246632`), and Windows CPU run
  `29706828552` at `f067482` (artifact `8448340646`). Every in-scope protected
  release chain passed legal/catalog preflight, locked build, native self-test,
  scientific validation, KMS signing, immutable R2 publication and public hash
  verification, real product install/inference with Jobs, Results and
  provenance, replacement/rollback/removal, beta promotion, evidence upload,
  and unconditional cleanup.
- Confirmed the live immutable release manifests and beta-channel endpoints for
  macOS arm64 Metal, Linux CPU, Linux CUDA 12.4, and Windows CPU return HTTP
  `200`. No Windows CUDA release or channel was used or claimed.
- Rebuilt Geneformer from a clean local directory on the current Apple M1
  checkout. Build, post-extraction self-test, cleanup, and the 4-cell x
  256-dimension Metal scientific fixture passed. The archive SHA-256 was
  `4c479e1600cc9154f9b08b0f876108e28f1999af58115b8d0b6ba46594986ee2`,
  maximum absolute error was `3.8743019104003906e-7`, and minimum cosine
  similarity was `0.9999999403953552`.
- Passed the zero-cost repository gates before alignment: 74/74 focused Runtime
  Box unit tests, 11/11 signer-policy tests, 11 Rust `runtime_box` tests with one
  ignored platform-specific test, 160/160 root verification tests, a clean
  Svelte check, core/frontend builds, and the Runtime Box catalog checker. Two
  initial local attempts were blocked only by restricted sandbox cache/network
  access; the identical commands passed with a gate-local cache and approved
  network, without a code workaround.
- Added the reviewed current Linux CUDA and Windows CPU evidence records, moved
  Windows CPU to `published`, aligned `packages/liatir-core` target selection,
  and corrected the compatibility/readiness documents. Windows CUDA remains
  `buildable` with no publication record and is not exposed as a supported
  target.
- Validation-only Geneformer run `29880520628` completed successfully on
  `macos-15` in mode `native-lifecycle` for `macos-aarch64-metal`, using clean
  remote `main` revision `d07b6b4c6f0df4e7aa4e56fad3ad60ccb5193610`.
  Preflight artifact `8514577659` proves the exact model, recipe, target, mode,
  and clean source revision. Final artifact `8514665653` has digest
  `sha256:b1b4911121897542bed0961bd0e93ac2ca88c7d17f6229913733a0a062630c74`
  and records status `passed`, runner label `macos-15`, Python `3.11.9`, uv
  `0.11.28`, archive SHA-256
  `d88a22d649a1184f4976070605b781341e41891d9dd8dff45c4961279161dde3`,
  4 x 256 finite Metal output, maximum accelerator-vs-CPU absolute difference
  `7.37607479095459e-7`, and minimum cosine similarity
  `0.9999999403953552`. The workflow also passed the Rust Runtime Box lifecycle,
  compact evidence upload, and unconditional cleanup. The native job ran for
  approximately five minutes, well below its 90-minute bound.
- The regression used only an ephemeral development signing key and performed
  no KMS signing, R2 publication, or channel promotion. It found no shared
  builder incompatibility, so the existing published macOS box was not
  republished. Gate 8.3 and Gate 8 are complete for the four in-scope targets.

Gate 8 is not complete while any gap remains **among the in-scope targets**. The
deferred Windows CUDA target is a documented exception and does not hold Gate
8.3, Gate 9, or Gate 10. Do not start Gate 9 before Gate 8.3 closes.

## Final gates

### Gate 9: macOS arm64 heavy runner

Register the development Apple silicon Mac as an on-demand, private,
single-concurrency self-hosted runner for heavy Runtime Boxes. It must remain
offline outside planned builds, use a dedicated clean work directory, require a
conservative disk preflight, clean all build state after success or failure, and
use GitHub OIDC to Cloud Run/KMS rather than local signing keys.

#### Local implementation, preflight, and first release attempt (2026-07-22)

- Added a checked `macos-arm64-heavy` runner profile with the unique
  `liatir-macos-arm64-heavy` label. Its contract is repository-scoped,
  ephemeral, single-concurrency, and clean-work-directory-only. UCE native CI
  now resolves to this profile; ordinary macOS Runtime Boxes remain on
  `macos-15`.
- Added `scripts/run-runtime-box-macos-heavy-runner.sh` (**superseded 2026-07-24**
  by the cross-OS `scripts/run-runtime-box-selfhosted-runner.sh` from the pixi
  migration's Phase 3, which keeps this exact contract and takes `--model`,
  `--target` and `--mode`; `npm run runtime-box:runner:macos-heavy` is unchanged
  for the operator). It requires an explicit
  absolute root outside the checkout, refuses an existing or symlinked root,
  verifies Apple silicon and a 35 GiB bootstrap disk floor, refuses concurrent
  registration of the custom label, and only then downloads the pinned official
  GitHub Actions runner. The reviewed package is macOS arm64 runner `2.336.0`
  with SHA-256
  `8e8839c49b7060b6b2154f4931f815df330c27f167d53ef2239ee3dfce28b079`.
- The launcher registers one repository-level runner with `--ephemeral`,
  `--disableupdate`, and `--no-default-labels`; it installs no service. It
  retains runner diagnostics separately, deregisters an unfinished exact
  runner identity, and removes the marked runner root on success, failure, or
  interruption. A 190-minute absolute online timeout prevents an unassigned
  runner from remaining online indefinitely.
- Native validation now rejects a self-hosted profile unless GitHub reports
  `RUNNER_ENVIRONMENT=self-hosted` and the exact reviewed runner-name prefix.
  Compact host evidence records the runner environment. Both validation and
  release workflows clean stale Runtime Box state before host probing and keep
  unconditional final cleanup. Native validation requires the exact `main` ref
  before any native runner is allocated.
- The protected production release remains the only Gate 9 closure path: it
  already requires exact `main`, environment `runtime-box-production`, GitHub
  OIDC, the private Cloud Run signer, and non-exportable KMS signing. The heavy
  runner launcher creates no local signing key.
- Cheap verification before the first release was complete: catalog check
  passed; the full verify profile passed 162/162 unit and contract tests, SDK
  generation, core TypeScript,
  Svelte check, frontend production build, and root TypeScript; focused Gate 9
  tests passed 22/22; Rust `runtime_box` tests passed 11 with the one established
  large fixture ignored; workflow YAML and shell syntax parsed; and the diff is
  whitespace-clean. The first full unit attempt had one sandbox DNS failure
  while fetching the crates.io index; the same focused test passed 15/15 with
  approved network, and the subsequent full verify passed 162/162.
- The development host is a 16 GiB Apple M1 on macOS 14.4.1. The UCE catalog
  requires `32,212,254,720` free bytes at job host-probe time; its calculated
  clean-build peak is `31,348,550,817` bytes. The launcher deliberately requires
  `37,580,963,840` free bytes before runner setup so checkout, runner binaries,
  and package setup cannot consume the build margin. The real preflight stopped
  at `7,497,203,712` free bytes before GitHub authentication, runner download,
  registration-token creation, or workflow dispatch. The repository runner
  inventory was empty when audited. Approximately 10.35 GiB in
  `src-tauri/target` is locally regenerable, but removing it alone would still
  not satisfy the bootstrap floor; no files were deleted.
- After the maintainer freed additional regenerable cache space and refreshed
  GitHub authentication, the exact launcher `--preflight-only` command passed
  with `39,284,838,400` free bytes. It also confirmed the custom heavy-runner
  label had no competing registered runner. The earlier disk blocker is
  resolved; no runner package, registration token, runner, or workflow run was
  created by the passing preflight.
- Commits `3df9ac8` and `0c8310f` were pushed to exact remote `main`. After the
  required runner, timeout, bandwidth, and service-cost approval, protected
  release run `29889431937` was dispatched for
  `snap-stanford-uce-4layer` / `macos-aarch64-metal` / `beta` at exact revision
  `0c8310f7c23a32a13710b56bae558c77710aba7c`. Resolve job `88826727465`
  passed. Ephemeral runner `liatir-macos-heavy-1784692230-27603` accepted only
  release job `88826776619`; clean checkout, host/storage validation, GitHub
  OIDC authentication, gcloud setup, npm install, pinned uv setup, and the exact
  clean-revision check all passed.
- The build downloaded and hash-verified every declared UCE asset, then stopped
  before self-test execution, signing, scientific validation, publication, or
  promotion with a missing-self-test-file error for
  `model-cache/uce/model_files/species_offsets.pkl`. The exact cause is in the
  shared archive extractor: extracting `protein_embeddings.tar.gz` into
  `model-cache/uce/model_files` recursively removed that destination first,
  deleting the four already verified sibling assets. This was not a Figshare,
  KMS, OIDC, or runner failure.
- Run `29889431937` therefore concluded `failure`. Its compact failed release
  evidence is artifact `8517777517`, 650 bytes, digest
  `sha256:084abf567d2750410e0c105f1b325363d43d9a07195003f5cc372f0b5eacad4a`.
  Publication and beta promotion steps were skipped. Unconditional workflow
  cleanup passed; the ephemeral runner deregistered, its marked work root was
  removed, diagnostics were retained, the repository runner inventory returned
  to zero, and the host recovered `38,710,562,816` free bytes.
- The target-independent local fix makes recipe archive extraction merge into
  an existing destination while refusing collisions with already staged files.
  Two regressions reproduce both requirements: a sibling asset survives the
  merge, and a colliding archive entry fails without changing the verified
  original. The focused archive suite now passes 15/15. The post-fix catalog
  check passes, Rust `runtime_box` tests pass 11 with the established large
  fixture ignored, and the full verify profile passes 164/164 plus SDK
  generation, core TypeScript, zero-warning Svelte check, frontend production
  build, and root TypeScript. No full UCE download or remote run was used to
  debug the defect.

#### Closure evidence (2026-07-22)

- Fix commit `8e1251274695b266fb52905e3e2d1a1b40a1b6ee` was pushed to exact
  remote `main`. The production workflow and its catalog-derived inputs were
  reread before dispatch. After fresh approval of the self-hosted runner,
  180-minute job timeout, approximately 9.12 GB of source assets, approximately
  8.86 GB of publication upload, and Cloud Run/KMS/R2 exposure, one new release
  was queued rather than rerunning the failed attempt.
- Protected release run `29909249357` used
  `snap-stanford-uce-4layer` / `macos-aarch64-metal` / `beta` at exact revision
  `8e1251274695b266fb52905e3e2d1a1b40a1b6ee`. Resolve job
  `88887957863` passed. Release job `88888035723` ran only on ephemeral runner
  `liatir-macos-heavy-1784713742-2693` with the exact
  `liatir-macos-arm64-heavy` label and concluded `success`.
- The protected job passed clean checkout and host storage, GitHub OIDC,
  gcloud, pinned uv, the clean-revision guard, build and private KMS signing,
  independent signed-release verification and native self-test, pinned UCE
  Metal scientific validation, immutable publication with streamed public-hash
  verification, beta promotion, compact evidence upload, and unconditional
  build cleanup. The macOS-only workflow correctly skipped Linux/Windows
  product E2E steps; Gate 8.3 separately retains the macOS Rust Runtime Box
  lifecycle evidence used for cross-platform closure.
- Reviewed evidence record
  `runtime-boxes/evidence/uce-4layer-macos-aarch64-metal-1.0.0-beta.1-run-29909249357.json`
  records status `passed`, the KMS key `liatir-runtime-box-kms-2026`, archive
  SHA-256 `63fc02de8e91699176510051be38790ab69739a92fe32052011081ad8297c960`,
  archive size `8,864,908,393`, installed size `10,142,864,860`, and scientific
  output shape `10 x 1280` with finite values, maximum absolute Metal/CPU
  difference `2.5704503059387207e-7`, and minimum cosine similarity
  `0.9999999999969341`.
- Compact artifact `8525984364` is 2,551 bytes with digest
  `sha256:8166557f9953e4713e577558da5fe485d732e57aef299dbb54fb35630842fbaf`.
  Its publication receipt points to immutable release manifest SHA-256
  `8e0c8c0174acfb44a8c8d956d13a6a584fa65bb757c134e9e120a67c76e95430`
  and records beta promotion HTTP `200`. A separate public read verified that
  exact manifest hash and confirmed the signed beta channel serves the new
  release at 100% rollout.
- The runner listener exited `0`, removed `.credentials` and `.runner`, and the
  launcher retained diagnostics before removing the marked work root. The
  repository runner inventory returned to zero, the root is absent, and the
  host recovered `43,393,630,208` free bytes. Gate 9 is complete; no runner is
  left online and no further Gate 9 release is authorized or required.

### Gate 10: operational handoff

Completed on 2026-07-22 from the reviewed Gate 8 and Gate 9 evidence:

- Added `.mind/roadmap/runtime-box-production-report.md` as the
  canonical production and operator handoff. It records the exact supported
  matrix, production run and artifact IDs, signing/hosting separation, GitHub
  Environments, variable and secret names, workflow paths, WIF providers and
  principal-set forms, service accounts, Cloud Run/KMS/R2/Worker resources,
  dispatch and rotation commands, authorization boundaries, bounded
  monitoring, evidence retention, cleanup, trust rotation, and revocation stop
  conditions. It contains no secret values.
- Updated `runtime-boxes/README.md`, the compatibility matrix, evidence guide,
  signer README, and Registry README so the protected workflows are the
  canonical production path and direct CLI commands remain explicitly
  consequential operator surfaces.
- Aligned the single-cell status, AI batch ledger, Beta 1 readiness, Scientific
  AI Workbench plan, .mind navigation, and current handoff. The Runtime
  Box CI foundation is complete, while a true cross-version native update and
  client-persisted anti-replay state remain separate product backlog items.
- Preserved the honest support boundary: CUDA is validated only on Linux;
  `windows-x86_64-cuda12.4` remains buildable but unvalidated, unpublished,
  unsupported, and prohibited from dispatch under the current decision.
- Zero-cost closure validation passed: `npm run runtime-box:catalog:check`
  validated 3 model records and 3 foundation fixtures;
  `npm run runtime-box:signer:check` passed 11/11 tests;
  `npm run test:verify` passed 164/164 unit and contract tests plus SDK type
  generation, core build, Svelte check, frontend build, and root TypeScript
  compile; `npm run docs:internal:build` rendered the complete internal site.
  No runner, signer deployment, publication, Registry mutation, or paid remote
  action was required.

Gate 10 and the bounded Runtime Box CI foundation are complete. Future Runtime
Box changes must continue to use the evidence, cost, identity, and
authorization rules retained in this ledger and the production report.

Post-foundation product closure (2026-08-11): the separate true cross-version
update and client-persisted anti-replay backlog named above is now complete.
One lightweight native suite passed on macOS arm64, native Windows x86_64, and
WSL2 Linux x86_64 using a separately compiled and verified ELF64 binary under
Xvfb. This later product evidence does not alter the historical foundation
gates, catalog identities, signed releases, or trust roots recorded here.

Post-foundation oncology publication (2026-08-30): protected production release
`33267756734` published MHCflurry `2.2.1-beta.1` only for
`macos-aarch64-metal`, and release `33330550558` published pVACseq
`7.1.2-beta.1` only for `macos-aarch64-cpu`. Both used the non-exportable KMS
key, passed their component-specific scientific and packaged-product lifecycle
gates, promoted signed beta channels, survived independent public signature and
full-archive hash readback, and retain checked-in production evidence. The
normal product catalogs expose only those exact targets; all other oncology
targets remain planned and hidden. Each ephemeral runner removed its credentials
and work root, and the repository runner inventory returned to zero.

## Foundation completion criteria

The foundation is complete only when:

- the repository is synchronized after every completed gate;
- active catalog, workflows, and documentation contain no macOS Intel target;
- target-ID and catalog contracts pass across languages;
- synthetic clean build, verify, rebuild, install, and cleanup pass on macOS
  arm64, Linux x86_64, and Windows x86_64;
- Linux and native Windows T4 preflights pass through shared helpers;
- a real Geneformer target completes scientific parity, signed immutable
  publication, promotion, native product lifecycle, Jobs, Results, provenance,
  removal, and retained Result evidence on Linux and native Windows;
- production signing remains non-exportable and separated from artifact hosting;
- documentation and readiness claims match reviewed evidence exactly.

## Local verification entry points

Read the current `package.json` scripts before running commands. The established
entry points are:

```text
npm run runtime-box:catalog:check
npm run runtime-box:test:foundation
npm run runtime-box:test:native
npm run runtime-box:validate:geneformer
npm run test:verify
```

Do not assume these commands remain stable; the repository scripts are always
authoritative.
