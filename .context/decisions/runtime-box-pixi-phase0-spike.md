# Runtime Box pixi migration — Phase 0 relocation/activation spike (decision record)

Date: 2026-07-24
Author: local hands-on spike — macOS arm64 / Metal (macOS 14.4.1, Apple Silicon), then win-64
CPU/CUDA on Windows 11, then linux-64 CPU/CUDA under WSL2 Ubuntu 26.04 (same Windows box)
Feeds: [Runtime Box pixi migration](../history/runtime-box-pixi-migration.md) — this record fixes the
shape of Phases 1–2.

Status: **DONE for macOS Metal, Windows (CPU + CUDA) AND Linux (CPU + CUDA). Decisive and
complete.** The one genuinely unknown risk in the migration plan (does a relocated conda/pixi
prefix import cold with no activation env?) is resolved for the osx-arm64 target, the harder
no-rpath **win-64 CPU/CUDA** case, and **linux-64 CPU/CUDA**. **No target on any OS needs an
activation environment.** Phase 0 has no open per-OS unknown left (see "Per-OS results").

## Question this spike had to answer

The migration replaces the hand-rolled uv + python-build-standalone builder with conda-forge
packages packed for relocation. The open risk: a conda/pixi environment needs a one-time **prefix
relocation** after extraction to a new absolute path, and conda libraries **may require
environment activation** (`CONDA_PREFIX` / `PATH` / `DYLD_/LD_LIBRARY_PATH`) to import — whereas
today's Rust self-test runs the interpreter with **no injected environment**
(`run_self_test`, `src-tauri/src/bridge/runtime_boxes.rs:1110`, literally
`Command::new(python_path).args(["-c", &script])` with nothing added). If activation were
required, the whole Rust install/run path would have to change.

## What was actually done (evidence)

All local, zero-cost, on one target (macOS Metal). pixi 0.73.0, pixi-pack/pixi-unpack 0.7.10,
conda-pack 0.9.2, all installed contained under a scratchpad `PIXI_HOME` (no system changes).

1. **Created a pixi env for the scGPT dependency set at torch 2.8.0 from conda-forge**
   (`channels = ["conda-forge"]`, `platforms = ["osx-arm64"]`, `python 3.11`, `pytorch 2.8.0.*`,
   `anndata scipy pandas h5py tqdm numpy`). Resolved cleanly in ~12 s to
   `pytorch-2.8.0-cpu_generic_py311` (the osx-arm64 build carries MPS/Metal), python 3.11.15,
   numpy 2.4.6, anndata 0.12.19. The prefix is a real conda prefix (`conda-meta`, 100 packages,
   `bin/python -> python3.11`).

2. **Packed it two ways and extracted each to a *different* absolute path** (paths with spaces,
   mimicking real user locations), naming the extracted prefix `venv`:
   - **conda-pack** → `condapack.tar.gz` (213 MB). Extracted (plain `tar -xzf` into a dir named
     `venv`) to an `.../Application Support/Liatir/boxes/...` path. Emits an **already-extracted
     prefix tree** with a self-contained `bin/conda-unpack` **inside** the pack.
   - **pixi-pack** → `pixienv.tar` (153 MB). Emits a **channel of `.conda` package files** +
     `environment.yml` + `pixi-pack.json` — *not* an extracted tree. Materialized with the
     separate **`pixi-unpack`** binary (`--env-name venv`) to a `.../Volumes/Data/...` path; it
     re-installs the 100 packages and writes an `activate.sh` at the root.

3. **Cold-import test** — `import torch, anndata, numpy, scipy, pandas, h5py, tqdm` (the scGPT
   recipe's exact self-test import set), run from each relocated prefix:
   - under a **completely empty environment** (`env -i`, no `CONDA_PREFIX`/`PATH`/`DYLD_*`);
   - and under the **exact `run_self_test` condition** (inherited shell env with nothing added).
   Both passed for **both** tools.

4. **Rigor against silent fallback** — repeated the test after **moving the source pixi env and
   the package cache completely out of the way**, so any lingering absolute reference to a
   build/source prefix would have to fail. Both relocated prefixes still imported cleanly.

5. **Metal is real, not just present** — ran an actual `torch.randn(...).to("mps") @ ...` matmul
   on each relocated prefix under an empty environment; `torch.backends.mps.is_available()` is
   `True` and the compute returns. So Metal works after relocation, with no activation.

## Findings / decision

- **No activation environment is required on macOS Metal.** A relocated conda-forge prefix
  imports the full scGPT dependency set and runs Metal compute under a *fully empty* environment.
  → `run_self_test` stays as-is (inject nothing), and the runtime execution path
  (`python_env.rs` `spawn_in_env`/`run_in_env`, `ai_runtime.rs`) needs **no** `CONDA_PREFIX` /
  `PATH` / `DYLD_LIBRARY_PATH` injection on macOS. The plan's hypothesized manifest `activation`
  field is **not needed for macOS**.

- **Relocation on macOS is essentially free.** conda-forge macOS packages use
  `@rpath`/`@loader_path`, so even a naive extract imports without any fixer.

  > **SUPERSEDED (Phase 2, 2026-07-24): the fixer must NOT be run at all.** This record originally
  > recommended running `conda-unpack` "for full text-file correctness". Measurement during Phase 2
  > showed the opposite: conda-pack already rewrites the build prefix to a neutral placeholder, and
  > running `conda-unpack` *stamps the build machine's absolute path back in* — on a probe env, **0
  > files carried the prefix before the fixer and 36 after**. That path would then ship inside the
  > box (a developer-path leak) and still be wrong at the user's install location. The build
  > therefore never runs `conda-unpack`; it deletes the few service files that do carry the build
  > prefix (`conda-meta/pixi`, `conda-meta/pixi_env_prefix`, the `conda-unpack` script) and repairs
  > conda console-script shebangs to resolve Python next to themselves (reusing the uv path's
  > `repairPosixLaunchers`). Verified: a rebuilt scGPT macOS box contains **zero** occurrences of
  > the build or developer path. **Consequence: the Rust install flow needs no relocation step**,
  > which is why Phase 2 required no change to `runtime_boxes.rs`.

- **Chosen relocation mechanism: conda-pack with the embedded `conda-unpack`** (confirms the
  plan's recommended default). Reasons:
  - The pack is an **already-extracted prefix tree** that drops straight into the existing box
    layout as `venv`, and **rides inside the current ZIP + `box.json` + deterministic-zip +
    KMS-signing flow with no new external runtime dependency**.
  - The fixer is invoked as **`venv/bin/python venv/bin/conda-unpack`** — self-contained, using
    the box's own interpreter. (Its shebang is `#!/usr/bin/env python`; calling python explicitly
    bypasses the need for `python` on `PATH`, which matters because we inject no environment.)
  - pixi-pack is viable but strictly heavier: it ships **packages, not a tree**, requires a
    **bundled per-OS `pixi-unpack` binary** (via `managed_bins`) and performs a **full package
    install on the user's machine** at box-install time (slower, more moving parts, writes). Kept
    only as the documented fallback if conda-pack ever fails to pack a pixi-created env on some
    target.

- **On-disk box layout (fixed by this spike):**

  ```text
  <box-root>/
    venv/                     # conda-pack extracted prefix (name = venv)
      bin/python -> python3.11 # Unix; venv/python.exe at root on Windows
      bin/conda-unpack         # self-contained relocation fixer (run once, post-extract)
      conda-meta/ lib/ ...
    source/…  model-cache/…  box.json  …   # unchanged
  ```

  This keeps the **interpreter-convention invariant**: `venv/bin/python` is exactly what
  `venv_python_for` (`src-tauri/src/bridge/python_env.rs:176`) probes on Unix, unchanged. Verified
  present with both tools.

- **Rust install-flow shape (fixed by this spike):** after ZIP extract and before
  `run_self_test`, add one relocation step — run `venv/bin/python venv/bin/conda-unpack` against
  the final prefix (idempotent; safe under the existing `.stg-{uuid}` staging → `rename_with_retry`
  flow). No activation threading on macOS. Everything else in `runtime_boxes.rs` (archive verify,
  Zip64 extract, short staging for MAX_PATH, deterministic rollback prune, content-addressed
  download) is untouched.

- **Footprint (data for `runtimeBoxBuildDiskPlan`):** extracted prefix ≈ **833 MB** for scGPT at
  torch 2.8.0 (CPU/MPS); conda-pack `tar.gz` 213 MB, pixi-pack `tar` 153 MB. The uncompressed
  ~833 MB tree is larger than the current uv scGPT box → **Phase 1 must raise the `diskPlan`
  floors** (confirms migration-plan risk #7 as real, not hypothetical).

- **Recipe detail for Phase 1:** conda-forge names the framework **`pytorch`** (not `torch`), and
  the osx-arm64 build is `cpu_generic_*` with MPS. The Phase 1 `pixi.toml` schema must map the
  recipe's `torch` to `pytorch` and select the accelerator via conda subdir/variant, not a torch
  index URL.

## Windows result (CPU + CUDA) — decision-record fragment

Date: 2026-07-24. Local hands-on spike on the maintainer's Windows 11 box, RTX 4060 Ti (Ada,
compute 8.9), NVIDIA driver **591.86** (CUDA 13.1-capable), PowerShell 5.1, `tar` = bsdtar 3.8.4.
pixi 0.73.0, conda-pack 0.9.2, all contained under a scratch `PIXI_HOME` (no system changes).
Method matched the [Windows check prompt](../history/runtime-box-pixi-phase0-windows-check.md): conda-forge
`win-64` env → `conda-pack` → extract to a **different absolute path with a space**
(`C:\Users\…\Liatir Test\boxes\scgpt-{cpu,cuda}\venv`) → `venv\python.exe
venv\Scripts\conda-unpack-script.py` (on Windows the fixer is invoked via the `-script.py`, not the
`conda-unpack.exe` launcher) → cold test in a **fresh shell** with `CONDA_PREFIX` empty and the venv
**not** on `PATH`.

The answers to the exact question:

- **CPU — cold import works with NO activation env? → YES.** `pytorch 2.8.0 cpu_mkl_py311`;
  `import torch, anndata, numpy, scipy, pandas, h5py, tqdm` succeeds cold, and still succeeds after
  the source `.pixi\envs\default` prefix is renamed away (no silent fallback to the build prefix).
- **CUDA — cold import works with NO activation env? → YES.** **CUDA compute works? → YES.**
  `pytorch 2.8.0 cuda128_mkl_py311`; in a no-activation shell `torch.cuda.is_available()` is `True`,
  device `NVIDIA GeForce RTX 4060 Ti`, `torch.version.cuda` = `12.8` (confirms the CUDA build, not
  the CPU fallback), and a real `torch.randn(512,512,device='cuda')` matmul returns. Both still pass
  with the source prefix renamed away.
- **Minimal activation env, if any → NONE for either.** The no-rpath Windows risk did not
  materialize: conda-forge PyTorch bootstraps its own DLL search directories (torch calls
  `os.add_dll_directory` on its `lib`/`Library\bin` at `import torch`) relative to the **relocated**
  prefix, so no `PATH` entry, no `os.add_dll_directory` injection from Rust, and no `CONDA_PREFIX`
  are needed for CPU import, CUDA import, or CUDA compute. Step "find the minimal activation env"
  from the prompt was reached only as a contingency and was **not** required.

**Important recipe finding (feeds Phase 1/Phase 5 for win-64 CUDA):** conda-forge has **no CUDA
build of `pytorch 2.8.0` at cuda-version 12.4 for win-64**. The solver silently picks the
`cpu_mkl` build unless the CUDA build is forced, and the forced CUDA build
(`pytorch = { version = "2.8.0.*", build = "cuda*" }`) resolves to **`cuda128_*` requiring
`cuda-version >=12.8,<13`** (ships `cuda-cudart 12.8.90`, `cudnn 9.10.2`, `libcudnn`, and
`cudart64_12.dll` / `cudnn64_9.dll` / `cublas64_12.dll` into `venv\Library\bin`). So the win-64
CUDA target must be pinned to **CUDA 12.8, not 12.4** — conda ships the CUDA runtime, and only the
**driver** must be current (591.86 ≫ the R550+ / ≥551.61 floor, so 12.8 is amply supported). The
plan's "CUDA 12.4" label for the Windows target should be updated to **12.8** wherever it appears.

**Footprint (data for the `diskPlan` floors):** extracted `win-64` prefix ≈ **1345 MB** (CPU) and
≈ **6.5 GB** (CUDA, driven by `libcudnn` ~486 MB + the CUDA runtime/`cublas`). conda-pack `tar.gz`:
402 MB (CPU), 4.0 GB (CUDA). The CUDA tree is far larger than any current uv box → the Phase 1
`diskPlan` floors must account for a **multi-GB CUDA box**, not just the ~833 MB macOS figure.

## Linux result (CPU + CUDA) — decision-record fragment

Date: 2026-07-24. Local hands-on spike on **WSL2** on the maintainer's Windows box: **Ubuntu
26.04 LTS**, **glibc 2.43** (`ldd (Ubuntu GLIBC 2.43-2ubuntu2)`), native **x86_64** (no emulation),
kernel `6.18.33.2-microsoft-standard-WSL2`, RTX 4060 Ti (Ada, compute **8.9**), NVIDIA-SMI
`610.43.02` / KMD `610.62` / CUDA UMD **13.3**. pixi 0.73.0, conda-pack 0.9.2, all contained under a
scratch `PIXI_HOME` (no system changes). Everything ran **inside the WSL filesystem** (`~`), never
under `/mnt/c`. Method matched the [Linux check prompt](../history/runtime-box-pixi-phase0-linux-check.md):
conda-forge `linux-64` env → `conda-pack` → extract to a **different absolute path containing a
space** (`~/some other place/liatir/boxes/scgpt-{cpu,cuda}/venv`) → **`conda-unpack` never run** →
cold test under a **fully empty environment** (`env -i`: no `CONDA_PREFIX`, no `LD_LIBRARY_PATH`,
venv not on `PATH`).

> **WSL caveat (stated explicitly, as the prompt requires):** WSL2 is a real Linux kernel with a
> real glibc/dynamic linker on native x86_64, but it reaches the GPU through a **driver bridge** —
> the process maps `/usr/lib/wsl/lib/libcuda.so.1` (backed by
> `/usr/lib/wsl/drivers/nv_dispsi.inf_amd64_*/libcuda.so.1.1`), not a bare-metal
> `libcuda.so`. The CUDA result below is therefore **strong evidence, not byte-identical to
> bare-metal Linux**. If the Phase 3 Linux CUDA runner ends up being bare metal, re-confirm there.
> Note that only the **driver** comes from the bridge: cuDNN, cuBLAS and `libtorch_cuda` were all
> verified to load **from the relocated prefix** (see the map evidence below), which is exactly the
> part relocation could have broken.

The answers to the exact question:

- **CPU — cold import works with NO activation env? → YES.** `pytorch 2.8.0 cpu_mkl_py311_*_102`
  (with `libtorch 2.8.0 cpu_mkl_*`), python 3.11.15, numpy 2.4.6, anndata 0.12.19 — the same
  resolution as win-64 CPU. `env -i venv/bin/python -c "import torch, anndata, numpy, scipy,
  pandas, h5py, tqdm"` → `IMPORT OK 2.8.0`, exit 0, and a real CPU matmul returns.
- **CUDA — cold import works with NO activation env? → YES. CUDA compute works? → YES.**
  `pytorch 2.8.0 cuda129_mkl_py311_h974e97e_302`. Under `env -i`: `torch.version.cuda` = **12.9**
  (confirms the CUDA build, not a CPU fallback), `torch.cuda.is_available()` `True`, device
  **NVIDIA GeForce RTX 4060 Ti**, compute capability `(8, 9)`, cuDNN `91002`, and a real
  `torch.randn(512,512,device='cuda')` matmul returns a finite sum.
- **Minimal activation env, if any → NONE for either.** conda-forge's `$ORIGIN`-relative RPATHs
  do the whole job: no `LD_LIBRARY_PATH`, no `CONDA_PREFIX`, no `PATH` entry. The prompt's
  "find the minimal environment" branch was never reached.
- **No silent fallback.** After `mv`-ing the source prefix (`proj-*/.pixi/envs/default`) completely
  away, both targets still passed cold import **and** the CUDA matmul, and `torch.__file__`
  resolved inside the relocated `venv`.
- **Runtime library provenance (CUDA, under `env -i`, `/proc/self/maps`):**
  `…/scgpt-cuda/venv/lib/libcudnn.so.9.10.2`, `…/venv/lib/libtorch_cuda.so`,
  `…/venv/targets/x86_64-linux/lib/libcublas.so.12.9.2.10` and `libcublasLt.so.12.9.2.10` — all
  from the **relocated** prefix, including the non-obvious `targets/x86_64-linux/lib` subtree,
  resolved with no `LD_LIBRARY_PATH`. Only `libcuda.so.1` comes from the host (WSL bridge), which
  is correct: the driver is always the host's.

**Important recipe finding (feeds Phase 1/Phase 3/Phase 5 for linux-64 CUDA) — the CUDA pin is
per-OS, do not copy Windows':** conda-forge builds `pytorch 2.8.0` for linux-64 against
**CUDA 12.9** (`cuda129_mkl_*`, requiring `cuda-version >=12.9,<13`, shipping `cuda-version 12.9`,
`cudnn 9.10.2.21`, `libcublas 12.9.2.10`). Pinning `cuda-version = "12.8.*"` — the value the win-64
target needs — **fails to solve** for linux-64; the solver reports that pytorch 2.8.0 would require
`cuda-version >=12.9,<13`, for which no candidates were found. So: **win-64 → 12.8,
linux-64 → 12.9.** The package's declared driver floor is only `__cuda >=12` (CUDA minor-version
compatibility), so any R525+ driver satisfies it; the 4060 Ti's is far newer.

**Manifest-syntax note for Phase 1:** pixi 0.73.0 accepts the `[system-requirements] cuda = "…"`
table used by this spike but warns it is **deprecated in favour of per-platform virtual packages**
(`platforms = [{ platform = "linux-64", cuda = "12" }]`). The generated Phase 1 `pixi.toml` should
emit the new form.

**Footprint (data for the `diskPlan` floors):** extracted `linux-64` prefix **1671 MiB (≈1.63 GB)**
CPU and **9739 MiB (≈9.5 GB)** CUDA; conda-pack `tar.gz` **527,580,718 B (≈503 MiB)** CPU and
**6,028,567,677 B (≈5.6 GiB)** CUDA. **Linux CUDA is the largest box in the whole matrix** — ~50 %
above win-64 CUDA (≈6.5 GB) and ~12× the macOS box — because conda-forge ships the full CUDA
runtime (`libtorch` alone is 836 MiB) plus `cublas`/`cudnn`. The Phase 1 `diskPlan` floors must be
sized from **this** number, and conda-pack compression of that tree took **5m24s** single-threaded,
which is real build wall-clock to budget for.

## Per-OS results (Phase 0 complete; carry into Phase 5)

| Target | Cold import, NO activation | Accelerator compute, NO activation | Extracted footprint | Activation env needed |
| --- | --- | --- | --- | --- |
| **macOS arm64 / Metal** | ✅ yes | ✅ Metal (MPS) matmul | ≈ 833 MB | **None** |
| **win-64 CPU** | ✅ yes | n/a (CPU) | ≈ 1.35 GB | **None** |
| **win-64 CUDA (12.8)** | ✅ yes | ✅ CUDA matmul on RTX 4060 Ti | ≈ 6.5 GB | **None** |
| **linux-64 CPU** | ✅ yes | n/a (CPU) | ≈ 1.63 GB | **None** |
| **linux-64 CUDA (12.9)** | ✅ yes | ✅ CUDA matmul on RTX 4060 Ti (WSL2 bridge) | ≈ 9.5 GB | **None** |

Every OS is now checked. The only residual qualification is the WSL driver-bridge caveat on the
**linux-64 CUDA** row: import, relocation, and the CUDA runtime libraries were all proven from the
relocated prefix, but the driver came through `/usr/lib/wsl/lib`. Re-confirm on the Phase 3 runner
if that runner is bare-metal Linux — a three-line re-run of the same cold-import + matmul check,
not a new spike.

**Design implication for Phase 2 (now confirmed on every OS):** keep the hypothesized
`activation` field on `LiatirRuntimeBoxReleaseManifest` **optional/nullable**, and it stays
**`null` for macOS, Windows *and* Linux (CPU and CUDA)** — no tested target carries one. The Rust
`run_self_test` / `spawn_in_env` / `run_in_env` / `ai_runtime` paths need **no** `CONDA_PREFIX` /
`PATH` / `LD_LIBRARY_PATH` / `add_dll_directory` injection anywhere. Do not hard-wire an activation
env for any target; if some future target ever needs one it can be added per-box without a
box-format change or a rebuild of the others.

## Not covered by this spike (out of Phase 0 scope, deliberately)

- The recipe's full `selfTest.pythonCode` (loads `best_model.pt` and asserts tensor shapes)
  needs the 205 MB model asset and is a Phase 5 re-validation concern, not a relocation question.
  The import set is the correct relocation proxy and is what `run_self_test` runs.
- Scientific parity on torch 2.8.0 (numbers may shift; re-baseline in Phase 5).
- The conda license-audit rework (`info/about.json` vs `.dist-info/METADATA`) — Phase 1.

## Reproduction

Contained spike under a scratchpad `PIXI_HOME`; nothing installed system-wide. Steps: `pixi.toml`
above → `pixi install` → `pixi-pack` and `conda-pack -p <prefix>` → extract each to a new absolute
path named `venv` → `env -i venv/bin/python -c "import torch, anndata, numpy, scipy, pandas, h5py,
tqdm"`. All exited 0.
