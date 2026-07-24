# Runtime Box pixi migration — Phase 0 relocation/activation spike (decision record)

Date: 2026-07-24
Author: local hands-on spike (macOS arm64 / Metal, macOS 14.4.1, Apple Silicon)
Feeds: [Runtime Box pixi migration](./runtime-box-pixi-migration.md) — this record fixes the
shape of Phases 1–2.

Status: **DONE for macOS Metal. Decisive.** The one genuinely unknown risk in the migration plan
(does a relocated conda/pixi prefix import cold with no activation env?) is resolved for the
osx-arm64 target. Linux and Windows still need the same short re-confirmation before their builds
(see "Scope and per-OS caveat").

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
   numpy 2.4.6, anndata 0.12.19. The prefix is a real conda prefix (`conda-meta/`, 100 packages,
   `bin/python -> python3.11`).

2. **Packed it two ways and extracted each to a *different* absolute path** (paths with spaces,
   mimicking real user locations), naming the extracted prefix `venv/`:
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
  `@rpath`/`@loader_path`, so even a naive extract imports without any fixer. We still run the
  fixer for full text-file correctness (shebangs, `python3.11-config`, pkgconfig, sysconfig) — it
  is cheap and self-contained.

- **Chosen relocation mechanism: conda-pack with the embedded `conda-unpack`** (confirms the
  plan's recommended default). Reasons:
  - The pack is an **already-extracted prefix tree** that drops straight into the existing box
    layout as `venv/`, and **rides inside the current ZIP + `box.json` + deterministic-zip +
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

## Scope and per-OS caveat (must carry into Phase 5)

Everything above is validated for **macOS arm64 / Metal only**. The "no activation env needed"
conclusion is **not automatically true on Linux and Windows** and must be re-confirmed with the
same three-line cold-import check before each of those targets is built:

- **Linux** (CPU/CUDA): `LD_LIBRARY_PATH` / `$ORIGIN` RPATH behavior; modern conda-forge is
  usually activation-free for import, but CUDA runtime discovery must be checked.
- **Windows** (CPU/CUDA): the real risk — no rpath; DLL search depends on `PATH` /
  `os.add_dll_directory`, and CUDA DLL discovery in particular may force a minimal activation env.
  A ready-to-run handoff prompt for the Windows machine (CPU + CUDA) is in
  [runtime-box-pixi-phase0-windows-check.md](./runtime-box-pixi-phase0-windows-check.md).

**Design implication for Phase 2:** make the hypothesized `activation` field on
`LiatirRuntimeBoxReleaseManifest` **optional/nullable**. macOS boxes carry none; if a specific
target (most likely Windows CUDA) turns out to need a minimal env, it can be added per-box without
a box-format change or a macOS rebuild. Do **not** hard-wire an activation env for all targets on
the strength of a single-OS spike.

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
