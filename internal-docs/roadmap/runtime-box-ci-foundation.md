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
| 8.1. Geneformer Linux pilot | In progress | Linux CPU complete; CUDA economical local gate in progress |
| 8.2. Geneformer Windows pilot | Not started | Requires Gate 8.1 |
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
- CUDA remains **in local correction**. The target cannot move to published or
  complete until the corrected commit passes the clean economical gate, real
  T4 inference, numerical parity, protected publication, complete product
  lifecycle, final evidence, removal, and cleanup.
- Lock reproducibility was rechecked independently with the verified uv 0.11.28
  binary and live indexes: the resolver selected the same 47 packages and
  reproduced dependency-lock SHA-256
  `4cc737f7bb6580de2fc6da0d89f2a17a2f200a35c82f5734f7e503c1772579ed`.

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
rounding. No further remote attempt is permitted until the size-aware lifecycle
bound, timeout diagnostics, complete economical local gate, and roadmap update
all pass.

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
