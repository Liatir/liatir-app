# Runtime Box cross-platform CI foundation

This tracked document is the durable implementation plan and handoff source for
Runtime Box CI work. Keep it current so development can continue from a local
checkout or GitHub Codespaces without relying on machine-local agent memory.

## Objective

Prove that Liatir can build, validate, sign, publish, install, run, and remove a
real AI Model Runtime Box on every supported native target while preserving one
shared contract in `packages/liatir-core`.

The supported target identities are:

- `macos-aarch64-metal`
- `macos-aarch64-cpu`
- `linux-x86_64-cpu`
- `linux-x86_64-cuda12.4`
- `windows-x86_64-cpu`
- `windows-x86_64-cuda12.4`

macOS Intel and Linux arm64 are not active Runtime Box targets. Native Windows
CUDA support must not be inferred from WSL2 or a Linux runner.

## Operating rules

- Work linearly, one gate and one native target at a time.
- Never batch paid GPU runners. GPU work is manual-only and scoped to one model
  and one target with concurrency `1`.
- Run cheap legal, catalog, dependency-lock, and peak-disk checks before a paid
  runner is allocated.
- Linux T4 is the first CUDA gate. Windows CUDA requires successful same-model
  Linux CUDA evidence for the exact commit.
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
| 8.2. Geneformer Windows pilot | In progress | Windows CPU lifecycle helper fix passes all local gates after release run `29657385347`; remote product proof remains required and Windows CUDA is blocked |
| 8.3. Cross-platform closure | Not started | Requires Gate 8.2 |
| 9. macOS arm64 heavy runner | Not started | Requires fresh approval |
| 10. Documentation and operational handoff | Not started | Evidence-driven only |

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
- [ ] After the generic lifecycle correction and all cheap gates, dispatch one
  final protected CPU proof. Require product lifecycle, beta promotion,
  complete evidence, and cleanup; stop CPU and keep CUDA blocked if it fails.

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

### Gate 8.3: cross-platform closure

1. Run the macOS arm64 workflow regression against the published target.
   Republish only if a shared builder change requires a new release.
2. Audit the complete Geneformer evidence chain across macOS arm64, Linux CPU
   and CUDA, and Windows CPU and native CUDA.
3. Confirm that one real AI Model has traversed legal review, dependency lock,
   build, self-test, scientific validation, KMS signing, R2 publication, channel
   promotion, and product-runtime evidence on Linux and native Windows.
4. Update catalog and readiness evidence only from produced, reviewed results.

Gate 8 is not complete while any target-specific gap remains. Do not start Gate
9 before Gate 8.3 closes.

## Remaining gates

### Gate 9: macOS arm64 heavy runner

Register the development Apple silicon Mac as an on-demand, private,
single-concurrency self-hosted runner for heavy Runtime Boxes. It must remain
offline outside planned builds, use a dedicated clean work directory, require a
conservative disk preflight, clean all build state after success or failure, and
use GitHub OIDC to Cloud Run/KMS rather than local signing keys.

### Gate 10: operational handoff

Update Runtime Box documentation, compatibility status, signer and Registry
operations, production report, AI roadmap, beta readiness, and this document
only from produced evidence. Record names of environments, variables, secrets,
workflows, WIF principals, commands, and verified run IDs, but never secret
values.

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
