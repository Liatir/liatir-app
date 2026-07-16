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
| 8.1. Geneformer Linux pilot | Not started | Next authorized implementation gate |
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
