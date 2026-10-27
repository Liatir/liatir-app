# OpenMM CUDA publication

The persistent operating guide for publishing OpenMM's CUDA Runtime Box, started 2026-10-27. It
must let another session resume without re-deriving anything: read **Current status** and **Next
action** first, then the phase you are in.

**Current status: Phases 1 and 2 passed; Phase 3 (commit and push) next.** Nothing has been
dispatched, signed or published by this plan yet.

## Objective and support matrix

Publish exactly one target on the `beta` channel: `openmm-openmm` / `linux-x86_64-cuda12.9`
(OpenMM 8.5.1, box release `8.5.1-beta.1`), making **Molecular Relaxation** and **Molecular
Dynamics** available. OpenMM is a scientific **Tool Runtime**, installed from Dependencies, never an
AI Model.

| Host | Requirement | After this plan |
| --- | --- | --- |
| Linux x86_64, native | NVIDIA GPU, driver 575.51.03 or newer | supported |
| Windows 11 x86_64, through WSL2 | NVIDIA GPU visible inside WSL2, Windows driver 576.02 or newer | supported |
| Linux or Windows without an NVIDIA GPU | — | not available; `linux-x86_64-cpu` stays authored and unpublished |
| macOS | — | not available; `macos-aarch64-cpu` stays authored and unpublished |
| AMD GPUs, native Windows payloads | — | not authored, out of scope |

## What must not change

- The twelve published targets of the seven other components, their channels and evidence.
- `services/runtime-box-signer/policy.json` (already deployed, see below), `runtime-boxes/trust/`,
  `runtime-boxes/target-id-contract.json`.
- OpenMM's CPU and macOS scrolls, locks and audits, except a pinned notice hash if the shared legal
  record changes. Their code and evidence are kept for a later release.
- The shared I/O contract and the AI Model / Tool Runtime separation.

## Verified starting state (2026-10-27)

Evidence was read from the repository and GitHub on this date, not from older reports.

- `main` equals `origin/main`, at `0c58c575` once the owner committed and pushed the deletion of
  an obsolete Cline memory file during this session (it started at `3304cc19`). No other change was
  pending.
- Catalog: the CUDA target is `native-lifecycle-validated`, `nativeCiEnabled: true`, lock
  `0bf2cb44…`, legal status `approved`. Scroll v3, `8.5.1-beta.1`, `minLiatirVersion` 0.2.1 (app is
  0.3.0).
- CI history: validation run 34514107583 (2026-09-10, before Scrollcase v3) passed build,
  self-test, the scientific validator and the Rust lifecycle. The v3 rebuild of 2026-09-11 was local
  and self-test only. The real-app product lifecycle last ran on 2026-09-10, locally, on a
  development archive. No OpenMM target has ever been published.
- Signer: `policy.json` lists `openmm` with its three targets. It was last deployed by run
  35141208671 at `a69a6751` (2026-09-16); `services/runtime-box-signer/` has not changed since, and
  later releases (for example 36246477862) passed the release's `verify-signer-policy` step. **No
  redeploy is needed**; the release re-verifies it before signing.
- GitHub environment `runtime-box-production`: a branch policy only, no required reviewers.
  `runtime-box-release.yml` already offers `openmm-openmm` and `linux-x86_64-cuda12.9`;
  `release-resolve` requires only `nativeCiEnabled`.
- Runner: this machine's WSL2 under the standing authorization in
  [Linux GPU CI runs on the owner's machine](../../decisions/linux-gpu-ci-on-the-owner-machine.md).
  RTX 4060 Ti, 8,188 MiB, compute capability 8.9, driver **610.88** (was 610.62), 724 GiB free.
- Product: `OPENMM_RELEASE_CANDIDATE_METADATA` is stale and OpenMM is not in
  `LIATIR_TOOL_RUNTIME_CATALOG`. The Tools page and the pipeline palette already switch both tools
  on from catalog membership alone.

## Findings that block a correct release

Each was verified, not inferred; the evidence is named.

1. **The NVIDIA driver floor is wrong.** The scroll and metadata say 525.60.13 (the CUDA 12.x minor
   version compatibility floor). OpenMM 8.5.1 compiles its kernels with NVRTC to PTX
   (`-arch=compute_…`, `nvrtcGetPTX`) and lets the driver JIT them (`cuModuleLoadDataEx`) — read in
   the 8.5.1 `CudaContext.cpp` and in the shipped plugin's imported symbols. The box's NVRTC
   12.9.86 emits `.version 8.8` PTX (measured with the box's own library). NVIDIA's cuda-python maps
   PTX ISA 8.8 to a minimum CUDA 12.9 driver, and the CUDA 12.9 release notes give 575.51.03 (Linux)
   and 576.02 (Windows). A user on 535 or 550 would download 1.3 GB and then fail every run with
   `CUDA_ERROR_UNSUPPORTED_PTX_VERSION`. See the
   [decision](../../decisions/openmm-cuda-needs-the-cuda-12-9-driver.md).
2. **The release evidence would be refused after promotion.** For a CUDA release,
   `write-release-evidence` requires the product lifecycle receipt to carry the GPU model, compute
   capability, CUDA version and a peak VRAM figure (`scripts/runtime-box/evidence.mjs`). OpenMM's
   spec records none of them. This is the failure that cost Boltz-2 a second release (run
   35207954903).
3. **The validator declares the CUDA version instead of measuring it**: it copies
   `recipe.target.cudaVersion` into `reportedCudaCompatibility`.
4. **The product metadata cannot install the published box.** It lists five targets including
   native Windows, and the Linux CUDA target without `windows-wsl2`. On Linux the app would pick the
   unpublished CPU target first; on Windows it would find no WSL2 candidate. The installer also
   requires the metadata's driver floor to equal the signed release's exactly.
5. **The UI offers Install on hosts that cannot run it**, says "This model" for a Tool Runtime, and
   the tool page does not state what hardware it needs.
6. **The legal record is silent about the CUDA target's NVIDIA runtime libraries** (`cuda-nvrtc`,
   `libcufft`, `cuda-version`), which the Boltz-2 and Protenix records already disclose.

Not owned by this plan, and not investigated: whether other CUDA components rely on PTX JIT. Their
torch builds ship compiled kernels, so finding 1 does not transfer to them automatically.

## Decisions

- **D1 — Driver floor 575.51.03, one value for both host environments.** Evidence: finding 1.
  Inside WSL2 the app compares the Windows driver version against the same field; a driver numbered
  575.51.03 or higher cannot belong to the R570 branch (whose Windows drivers are 572–573.xx), so
  the single floor admits exactly the CUDA 12.9-capable drivers on both. Rejected for now: re-locking
  with an older `cuda-version` to admit older drivers — a new solve, audit, build and full
  revalidation, worth a separate decision later. Verified by: unit guards that the metadata equals
  the scroll, the real install in the release, and the WSL2 install after publication.
- **D2 — The runner reports what OpenMM itself used.** For CUDA runs the product script records the
  `DeviceName` OpenMM chose, the compute capability of that device (CUDA driver API), the NVRTC
  version OpenMM compiled with, and the device-wide peak VRAM over the run (NVML, baseline before the
  context exists, sampled every 50 ms). Probed on the development payload: RTX 4060 Ti, 8.9, 12.9,
  about 119 MB over 6.6 s of steps, 117 samples during `step()`. NVML and `libcuda` resolve through
  the dynamic loader, including WSL2's `/usr/lib/wsl/lib`, where `nvidia-smi` is not on a no-shell
  `PATH`. A reading that fails is recorded as `null`, never invented; the validator and the lifecycle
  then fail visibly. Same method label as the validator's measurements.
- **D3 — Metadata is the product's, not a candidate's.** One CUDA target, `["native",
  "windows-wsl2"]`, driver 575.51.03 and `minRamGb` 8 exactly as signed; the release test binary and
  the product then share it, as for Boltz-2.
- **D4 — Extend the validator, not the threshold.** Keep the 0.01 kJ/mol Reference parity (observed
  1.7e-4 on CUDA mixed precision for 33 atoms). Add a thermostat check on solvated DHFR dynamics and
  a refusal for an unparameterizable residue, both calibrated on this GPU. The first rehearsal
  showed the first frame at 250.2 K: velocities drawn at 300 K on a minimized structure lose half
  their energy to the potential before Langevin friction (1/ps) restores it, so a per-frame band
  over the whole run would have flaked. The check therefore treats the first 5 ps as equilibration
  (held only to a 350 K blow-up ceiling) and requires the 5–10 ps frames within 20 K of 300 K and
  their mean within 10 K. Measured: 253.2, 282.1, 291.1, 298.2 K, then 297.7–301.6 K, mean
  299.58 K — a spread of about 2 K, as expected for 29,419 atoms.
- **D5 — Unsupported chemistry is refused by name.** OpenMM's "No template found for residue …"
  becomes "Residue N (NAME) cannot be parameterized by the reviewed force fields. If it is a
  small-molecule ligand, supply its SDF; otherwise remove it from the structure." Other errors are
  re-raised untouched.
- **D6 — The tool page and Dependencies say why a machine cannot run OpenMM**, using the same
  install block the installer applies: Install is disabled when blocked, the tool page shows the
  block and OpenMM's plain-language host requirement, and "This model" becomes "This Tool
  Runtime". The release-candidate spec waits for "Install required", which a compatible runner
  still shows.

## Phases

### Phase 1 — Pre-release corrections (in progress)

Changes: findings 1–6; tests that fail on the old values first.
Accept when: `test:verify` passes, the catalog check passes, the new guards were observed failing.

### Phase 2 — Local rehearsal on this GPU

Run the updated validator against the development payload in
`~/liatir-rb/openmm-linux-x86_64-cuda12.9/payload` (same lock), then check a composed
production-release record with `validateRuntimeBoxCiEvidence`.
Accept when: every case passes, CUDA readings are measured and agree with `nvidia-smi`, the composed
record validates.

### Phase 3 — Commit and push to `main`

The release workflow builds only committed bytes from `main`. Authorized by the owner's task
statement of 2026-10-27. Accept when: the remote hash is read back and the hosted preflight passes.

### Phase 4 — Production release

1. Inside WSL2, as a background task that stays alive for the whole job:
   `bash scripts/run-runtime-box-selfhosted-runner.sh --model openmm-openmm --target
   linux-x86_64-cuda12.9 --mode native-lifecycle --runner-root /home/lorenzo/liatir-release-openmm`.
2. `gh workflow run runtime-box-release.yml --ref main -f model_id=openmm-openmm -f
   target_id=linux-x86_64-cuda12.9 -f channel=beta`, after reading the workflow back.
Accept when: every step passes, including `write-release-evidence`. Never dispatch any other target.

### Phase 5 — Independent verification of the public release

Public channel and release document readable; signature verified against
`runtime-boxes/trust/production-public.json`; archive bytes re-hashed from the public URL; the
release evidence artifact downloaded and validated.

### Phase 6 — Product publication commit

Catalog `published` with its `publication` block and retained evidence; production measurement
retained and the hardware profile moved to it; OpenMM in `LIATIR_TOOL_RUNTIME_CATALOG`; public docs
(tool page, support matrix, Tool Runtime vs AI Model); context. Accept when: `test:verify` and the
catalog check pass and the guards cover the published target.

### Phase 7 — Windows through WSL2 against the published artifact

Windows test binary, production registry, `runtime-box-openmm-native.e2e.mjs` on
`linux-x86_64-cuda12.9`: install from the public channel, both tools on CUDA, Jobs, Results,
provenance, removal with Results kept. Retain the record under `runtime-boxes/measurements/`.

### Phase 8 — Final verification and checkpoint

`test:verify`; the affected `test:ui` suites; `cargo test` only if Rust changed; `syngraphe check`;
this page and `state/current.md` closed out.

## Scientific validation requirements

The validator runs on the exact production archive inside the release, before publication:
33-atom relaxation with Reference parity at most 0.01 kJ/mol, missing-hydrogen preparation,
protein–ligand (ethanol) and DHFR–ruxolitinib parameterization, 10 and 100 ps dynamics, exact
checkpoint continuation, DHFR at 2,489 atoms, solvated DHFR at 29,419 atoms (relaxation and 10 ps
dynamics), solvated checkpoint continuation, and refusals for changed release, target or settings,
an absent ligand and a corrupted checkpoint. CPU/GPU trajectory parity is not claimed: dynamics is
chaotic, so only energies at identical coordinates are compared.

## Risks and recovery

- **Publication is immutable.** A failure after `publish` and before `promote` leaves unreferenced
  objects and no channel change; fix and release again. A failure after `promote` (the evidence
  step) leaves the channel on an unrecorded release; the only clean recovery is another release,
  which is why finding 2 is fixed first.
- **A defective published box** is withdrawn with `runtime-box-revoke.yml`, by target.
- **The runner dies with its launching session.** Launch it as a background task and keep the
  session open; a killed runner looks like a product failure and is not one.
- **Driver floor too strict or too loose.** Too loose is the current state (finding 1); the floor
  chosen rests on NVIDIA's PTX table and a measured PTX header, and the Windows proof re-checks it.

## Progress log

- 2026-10-27 — Plan written; findings 1–6 verified as above. Probes ran on the development payload
  only; no build, dispatch or upload.
- 2026-10-27 — **Phase 1 implemented** (uncommitted):
  - driver floor 575.51.03 in `runtime-boxes/scrolls/openmm/linux-x86_64-cuda12.9/scroll.json` and
    `OPENMM_RELEASE_CANDIDATE_METADATA` (CUDA only, `native` + `windows-wsl2`, `minRamGb` 8);
  - CUDA readings in the product runner (`python-scripts/openmm.ts`, class `CudaDeviceReadings`),
    the GPU name in the Result's Compute row (`molecular-simulation/openmm.ts`);
  - validator: readings held to `nvidia-smi`, NVRTC CUDA measured, thermostat, unparameterized
    residue (`scripts/validate-openmm-runtime.mjs`);
  - product lifecycle receipt carries the four CUDA readings (`runtime-box-openmm-native.e2e.mjs`);
  - install block in Dependencies and on the tool page; legal record CUDA section, and its new
    SHA-256 `9363c902…` pinned in all three OpenMM scrolls.
  - Guards: `phase3-runtime-candidates` (metadata equals the signed scroll; floor pinned),
    `runtime-box-ci-catalog` (every published target's driver and memory floor equals its scroll,
    as the installer requires), `runtime-box-host-selection` (four OpenMM host cases). Each was
    observed failing on the old or a mismatched value, then restored.
- 2026-10-27 — **Phase 2 passed** on the RTX 4060 Ti (driver 610.88), development payload
  `~/liatir-rb/openmm-linux-x86_64-cuda12.9/payload`, dirty tree at `0c58c575`: 19 cases (13 runs,
  6 refusals including the new unparameterized residue). Every CUDA case reported "NVIDIA GeForce
  RTX 4060 Ti", 8.9 and NVRTC 12.9, matching `nvidia-smi`; Reference parity 1.7122e-4 kJ/mol; peak
  VRAM 181–185 MB (both samplers within about 5 MB of each other); solvated DHFR relaxation
  11.8 s and 10 ps dynamics 14.8 s. A production-release record assembled from this host's real
  probe (`writeHostEvidence`), the validator output and the receipt fields the spec now writes
  passed `validateRuntimeBoxCiEvidence`. Development evidence only; not retained as a measurement.
- 2026-10-27 — `npm run test:verify` passed all seven suites: 91 files / 706 tests passed, 17
  skipped, report `2026-10-27T20-09-59-941Z`. (The first attempt failed only because this fresh
  checkout lacked `packages/liatir-cli/node_modules`; `npm ci` there fixed it, no code change.)
  `syngraphe check` passes. The runner preflight passed for `liatir-linux-cuda-selfhosted` with
  776 GB free.

## Next action

When `test:verify` passes: commit Phase 1 (code, guards, legal, context) and push to `main`, read
the remote hash back, then start Phase 4.
