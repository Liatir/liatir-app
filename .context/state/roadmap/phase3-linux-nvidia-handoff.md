# Phase 3 handoff: the Linux + NVIDIA machine

Written 2026-09-09. This is the working brief for a session on a Linux x86_64 host with an
NVIDIA GPU — including Windows with WSL2, which is the same host environment as far as a
Runtime Box is concerned. It exists because three of Phase 3's four components cannot run
anywhere else, and because the fourth has a GPU target nobody has ever executed.

Read it together with the [Phase 3 implementation status](./phase3-implementation-status.md),
which holds the evidence, and the
[integration plan](./new-ai-models-integration-plan.md), which holds the requirements.

## Why this machine, specifically

- **Boltz-2, Protenix v2 and Protenix Mini Default run only on Linux x86_64 with NVIDIA.**
  macOS was taken out of scope for these three by the product owner on 2026-09-07. Nothing has
  ever executed for any of them, on any machine.
- **OpenMM's CUDA targets have never been built or measured.** Every retained OpenMM number is
  Apple M1 CPU. A GPU measurement is the only way to know what the tool actually costs on the
  hardware people will run production molecular dynamics on, and CPU cannot substitute:
  10 ps of solvated DHFR took 197 s on the M1, so a single production nanosecond would be
  roughly five and a half hours.
- No self-hosted runner is registered on the repository (`gh api
  repos/Liatir/liatir-stack/actions/runners` returned `total_count: 0`), so none of this can be
  reached from CI either.

## Verified starting state

Checked on 2026-09-09, not inferred:

Updated 2026-09-09 after the first session on this machine.

| component | scroll | lock | catalog | box | measurement |
| --- | --- | --- | --- | --- | --- |
| `openmm-openmm` | all 3 targets | all 3 targets | 3 targets, `planned` | macOS CPU **and Linux CUDA**, development key | macOS CPU **and Linux CUDA** |
| `jwohlwend-boltz-2` | `pixi.toml` only | **resolved** | absent | none | none |
| `bytedance-protenix-v2` | `pixi.toml` only | none | absent | none | none |
| `bytedance-protenix-mini-default-v0-5-0` | `pixi.toml` only | none | absent | none | none |

OpenMM went from five targets to three: its two native Windows targets were deleted on 2026-09-09,
and both Linux targets now declare `["native", "windows-wsl2"]`. No new component gets a native
Windows target — see
[No native Windows Runtime Box targets](../../decisions/no-native-windows-runtime-box-targets.md).
Every component here is developed for Linux and Windows-through-WSL2, plus macOS where possible;
for the three AI Models macOS is out of scope by the 2026-09-07 decision.

`candidate-inputs.json` exists for both Protenix components at the component level, not under
the target directory. Neither Protenix nor Boltz-2 has a `scroll.json`, a legal record in
`runtime-boxes/legal/`, a licence audit, a `runtime-boxes/catalog.json` entry, a signer policy
entry, a calling workflow, a product runner, a scientific validator or a hardware profile.

OpenMM is the complete worked example to imitate: `runtime-boxes/scrolls/openmm/`,
`scripts/validate-openmm-runtime.mjs`, `frontend/src/lib/tools/molecular-simulation/` and
`tests/e2e/specs/runtime-box-openmm-native.e2e.mjs`.

## Known blockers — do not rediscover them

- **Boltz-2 needs `fairscale==0.4.13`**, which is published only as source, so the dependency
  resolution requires a Linux host. This is the exact step that failed repeatedly on macOS.
- **The official Protenix v2 checkpoint returns HTTP 403** for both a HEAD and a one-byte GET.
  Mini and the shared files are reachable. Do not adopt an unofficial mirror without explicit
  authorization: resolve official access first.
- Protenix pins Triton, DeepSpeed and cuEquivariance. Do not loosen an upstream constraint to
  obtain a lock. If it does not resolve, report the exact conflict.

## Order of work

1. ~~**Verify the hardware from inside WSL2**~~ — done 2026-09-09. RTX 4060 Ti, 8188 MiB VRAM,
   driver 610.62, Ubuntu 26.04, 6 CPUs, 24 GiB to WSL2, 893 GiB free in the Linux filesystem. The
   full record is in the
   [Phase 3 status](./phase3-implementation-status.md#the-linux-cuda-authoring-and-measurement-host-2026-09-08).
2. ~~**Build and measure OpenMM `linux-x86_64-cuda12.9`**~~ — done 2026-09-09. Built, signed,
   `verify --self-test` passed on a fresh extraction, and the scientific validator passed 18 cases
   on the GPU. The toolchain is therefore proven end to end — driver, WSL2, CUDA 12.9, OpenMM — and
   the harder components can rely on it. Figures and the measurement defect this run exposed are in
   the [Phase 3 status](./phase3-implementation-status.md#openmm-cuda-is-built-self-tested-and-measured-on-a-real-gpu-2026-09-09).
   Building needs `--allow-dirty` while the tree has uncommitted work, `--conda-pack` pointing at
   the pixi-global binary, and `--build-dir` inside the Linux filesystem.
3. ~~**Resolve the Boltz-2 lock**~~ — done 2026-09-09 with pixi 0.73.0 in WSL2, graph inspected.
   `pixi.lock` is `f1e4a595010fe5c2d98e103c0b6b77ee8a80408ea80e25c661df29b2c4a1e88f`; findings are
   in the [Boltz source review](./phase3-boltz-source-review.md).
4. **Write the Boltz-2 scroll**: assets with pinned SHA-256 (use the revision and hashes already
   in the source review), an offline self-test, a legal record with the source revision, a
   licence inventory.
5. **Build locally with a development key, then `verify --self-test`.**
6. **Only then**: the product runner in the app, the scientific validator, a real run on real
   input, and RAM/VRAM/time measurements.
7. Repeat 3–6 for Protenix Mini Default, then Protenix v2 once its checkpoint access is resolved.

## Constraints

- **No GPU CI without separate, explicit authorization from the product owner.** Running locally
  on this machine is not CI and is allowed.
- Every R2 upload goes through GitHub Actions only. No publication from a dirty worktree or with
  a development key.
- **Never put a build workspace or a signing key under `/tmp`.** On another machine `/tmp` was
  cleared overnight and took the development key with it; a signed package whose key is gone can
  never be verified again, because the release document carries only a key id and a signature,
  never the public key. Use the workspace defaults: `.runtime-box-local` for keys, `.rb` for the
  build.
- Under WSL2, stay in the Linux filesystem (`~/…`), never under `/mnt/<drive>`: cross-filesystem
  I/O is far too slow for a multi-gigabyte conda prefix.
- No invented or extrapolated hardware profiles: a measurement or nothing.
- Components stay hidden until every one of their real gates passes.
- Disk: the CUDA targets declare 16 GiB of build space, and the Boltz-2 weights alone are about
  6.2 GB. Check free space **in the Linux filesystem** before starting.

## Gates

`npm run test:verify` before any delivery, plus `npm run test:ui` if UI, navigation or the
Job/Result lifecycle was touched. **Never run the two together** — they compile the same
SvelteKit directory and corrupt each other. Update this directory with evidence and remaining
work in the same session, and finish with `syngraphe check`.

## Records

- [Phase 3 implementation status](./phase3-implementation-status.md) — the evidence ledger.
- [Boltz-2 source review](./phase3-boltz-source-review.md) — pinned revision and asset hashes.
- [Protenix source review](./phase3-protenix-source-review.md) — commit
  `2475421477ab414b571149ad4a875c390ff8a35d`, candidate assets, the 403.
- [Runtime Box CI foundation](./runtime-box-ci-foundation.md) — runner profiles and cost policy.
- [Publication runs on hosted CI](../../decisions/runtime-box-publication-runs-on-hosted-ci.md).
