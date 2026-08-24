# Phase 0 activation check — Linux (CPU, + CUDA where a GPU exists) handoff prompt

This is a **self-contained prompt** to run in a Claude Code session **on a Linux x86_64 machine**.
It closes the last per-OS unknown from the Phase 0 spike.

**Where to run it — best option first:**

- **WSL2 on the maintainer's Windows box (recommended).** Native x86_64 (no emulation), a real Linux
  kernel/glibc/dynamic linker, **and** it can cover **Linux CUDA** too, because WSL2 passes the
  RTX 4060 Ti through (driver 591.86 is recent enough). Two caveats: work inside the WSL filesystem
  (`~/`), never under `/mnt/c/...`, where I/O is far too slow for a multi-GB conda env; and WSL
  reaches the GPU through a driver bridge (`/usr/lib/wsl/lib/libcuda.so.1`), so a CUDA pass here is
  strong evidence but not byte-identical to bare-metal Linux — if the Phase 3 Linux CUDA runner ends
  up being bare metal, re-confirm there.
- **A GitHub Codespace.** Native x86_64, nothing to install locally, but **CPU only** (no GPU).
- **A bare-metal Linux machine.** Ideal, and the only one that settles Linux CUDA definitively.
- **Not** the maintainer's macOS machine: no container runtime is installed, and an Apple-Silicon
  container would emulate x86_64 anyway.

Status: **CLOSED — executed 2026-07-24 under WSL2 (Ubuntu 26.04, glibc 2.43, RTX 4060 Ti).**
Both targets passed: cold import and a real CUDA matmul succeed under a fully empty environment,
with no activation env, and still pass with the source prefix removed. Phase 0 is now complete on
all three OSes. **The answers live in the "Linux result" section of the
[Phase 0 decision record](./runtime-box-pixi-phase0-spike.md)** — read that, not this prompt.
Two findings worth carrying: linux-64 pins **CUDA 12.9** (`cuda129`, not the win-64 12.8 — 12.8
does not solve at all on linux-64), and the extracted Linux CUDA prefix is **≈9.5 GB**, the largest
box in the matrix. The scratch environment was deleted; the record is the deliverable. The prompt
below is retained only as the reproduction procedure.

Related: [Phase 0 decision record](./runtime-box-pixi-phase0-spike.md),
[Windows check](./runtime-box-pixi-phase0-windows-check.md),
[pixi migration plan](./runtime-box-pixi-migration.md).

---

## PROMPT

You are on Linux x86_64. This is a **local, zero-cost hands-on spike**. Do not touch CI, do not run
anything paid or remote, install everything **contained** under a scratch `PIXI_HOME`, and change no
production code. Read `.mind/roadmap/runtime-box-pixi-phase0-spike.md` first.

**If you are running under WSL2 (the expected case):**

- Do all of this **inside the WSL filesystem** (e.g. `~/pixi-phase0-linux`), never under
  `/mnt/c/...` — cross-filesystem I/O there is far too slow for a multi-gigabyte conda env.
- For the CUDA target, first confirm the GPU is actually visible from Linux: run `nvidia-smi` and
  expect the RTX 4060 Ti. WSL reaches it through a driver bridge
  (`/usr/lib/wsl/lib/libcuda.so.1`), so **say so explicitly in your report**: a CUDA pass under WSL
  is strong evidence but not identical to bare-metal Linux.
- Report the distro and glibc version (`ldd --version`) — conda-forge targets an old glibc, but the
  number belongs in the record.

### The exact question

A Runtime Box ships a conda-forge prefix that has been packed with conda-pack and **never had
`conda-unpack` run on it** (Phase 2 measured that running the fixer stamps the build machine's path
into the box, so we deliberately skip it). The Rust self-test launches the interpreter with **no
injected environment** (`run_self_test`, `src-tauri/src/bridge/runtime_boxes.rs`). So:

> After extracting such a prefix to a **different absolute path**, does
> `venv/bin/python -c "import torch, anndata, numpy, scipy, pandas, h5py, tqdm"` succeed with **no
> `CONDA_PREFIX`, no `LD_LIBRARY_PATH`, and the venv not on `PATH`** — and, on a GPU box, does a real
> CUDA tensor op run? If not, what is the **minimal** environment that makes it work?

macOS and Windows both answered "works cold, nothing needed". Linux is expected to behave the same
(conda-forge builds use RPATH `$ORIGIN`), but it must be confirmed, not assumed.

### Setup (contained)

```bash
export ROOT="${TMPDIR:-/tmp}/pixi-phase0-linux"
mkdir -p "$ROOT" && cd "$ROOT"
export PIXI_HOME="$ROOT/pixi" PIXI_NO_PATH_UPDATE=1
curl -fsSL https://pixi.sh/install.sh | bash
"$PIXI_HOME/bin/pixi" --version
"$PIXI_HOME/bin/pixi" global install conda-pack
```

### Target A — linux-64 CPU

`$ROOT/proj/pixi.toml` (conda-forge names the framework **`pytorch`**, not `torch`):

```toml
[workspace]
name = "scgpt-phase0-linux-cpu"
channels = ["conda-forge"]
platforms = ["linux-64"]

[dependencies]
python = "3.11.*"
pytorch = "2.8.0.*"
anndata = "*"
numpy = "*"
scipy = "*"
pandas = "*"
h5py = "*"
tqdm = "*"
```

### Target B — linux-64 CUDA (only on a machine with an NVIDIA GPU)

Same, plus a CUDA system requirement so the solver picks the GPU build. **Check which CUDA version
conda-forge actually builds `pytorch 2.8.0` against for linux-64** and pin that (on win-64 it turned
out to be **cuda 12.8**, not 12.4 — do not assume):

```toml
[system-requirements]
cuda = "12.8"

[dependencies]
cuda-version = "12.8.*"
# … same as A
```

After `pixi install`, confirm you got the CUDA build: `pixi list | grep pytorch` — the build string
must contain `cuda`.

### Steps (for each target)

1. `"$PIXI_HOME/bin/pixi" install --manifest-path "$ROOT/proj/pixi.toml"` → prefix at
   `$ROOT/proj/.pixi/envs/default`.
2. Pack: `"$PIXI_HOME/bin/conda-pack" -p "$ROOT/proj/.pixi/envs/default" -o "$ROOT/env.tar.gz" --format tar.gz`
3. Extract to a **different absolute path** whose name is `venv`, including a space to mimic a real
   user location:
   ```bash
   DEST="$ROOT/some other place/liatir/boxes/scgpt/venv"; mkdir -p "$DEST"
   tar -xzf "$ROOT/env.tar.gz" -C "$DEST"
   ```
   **Do NOT run `conda-unpack`** — shipping boxes never do.
4. **Cold import, empty environment** (stricter than the Rust self-test, which merely injects
   nothing):
   ```bash
   env -i "$DEST/bin/python" -c "import torch, anndata, numpy, scipy, pandas, h5py, tqdm; print('IMPORT OK', torch.__version__)"
   ```
   Record success/failure and the full traceback on failure (a Linux failure looks like
   `ImportError: libXXX.so.N: cannot open shared object file`).
5. **CUDA compute proof** (target B only), same empty environment:
   ```bash
   env -i "$DEST/bin/python" -c "import torch; print('cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0)); x=torch.randn(512,512,device='cuda'); print('sum', float((x@x).sum()))"
   ```
6. **Rigor against silent fallback:** move the source prefix aside
   (`mv "$ROOT/proj/.pixi/envs/default" "$ROOT/away"`) and re-run steps 4/5 from `$DEST`. It must
   still pass with the source gone.
7. Record the extracted prefix size (`du -sh "$DEST"`) for the `diskPlan` floors.

### If the cold import FAILS — find the MINIMAL environment

Add candidates one at a time, smallest first, and re-test to find the minimal set:
`LD_LIBRARY_PATH="$DEST/lib"`, then `"$DEST/lib:$DEST/lib/python3.11/site-packages/torch/lib"`,
then `CONDA_PREFIX="$DEST"`, then `PATH="$DEST/bin:$PATH"`. Report **exactly** which are required —
that is what the Rust run path would have to inject, and it would mean adding an `activation` field
to the release manifest for linux targets only.

### Output (write it back into the repo)

Produce a decision-record fragment answering, for **CPU** and (if tested) **CUDA**:

- Cold import works with NO activation env? (Y/N)
- If N: the **minimal** environment required.
- CUDA available + real compute works? (Y/N), GPU name, and that the CUDA build was used.
- The CUDA version conda-forge actually builds pytorch 2.8.0 against for linux-64.
- Extracted prefix footprint.
Then update the per-OS section of `runtime-box-pixi-phase0-spike.md` and flip the Linux caveat in
`runtime-box-pixi-migration.md` / `current-project-status.md`. Delete the multi-GB scratch env when
done — the record is the deliverable.

--- end PROMPT ---
