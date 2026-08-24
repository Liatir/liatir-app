# Phase 0 activation check — Windows (CPU + CUDA) handoff prompt

> **DONE 2026-07-24 on the maintainer's RTX 4060 Ti box (driver 591.86). Decisive.** Result:
> **no activation env is required on Windows for CPU or CUDA** — a relocated conda-forge `win-64`
> prefix imports the full scGPT set cold and runs a real CUDA matmul on the RTX 4060 Ti with
> `CONDA_PREFIX` empty and the venv not on `PATH`, and still passes with the source prefix removed.
> One recipe correction: conda-forge's CUDA `pytorch 2.8.0` for win-64 is **cuda128** (needs
> `cuda-version >=12.8`), so the Windows CUDA target must be pinned to **CUDA 12.8, not 12.4**.
> Full findings + per-OS table: [Phase 0 decision record](./runtime-box-pixi-phase0-spike.md#windows-result-cpu--cuda--decision-record-fragment).
> The prompt below is kept for reproducibility.

This is a **self-contained prompt** to run in a Claude Code session **on the Windows machine**
(the maintainer's RTX 4060 Ti box). It closes the one per-OS unknown left open by the macOS Phase 0
spike. Paste everything under "PROMPT" into that session.

Related: [Phase 0 decision record](./runtime-box-pixi-phase0-spike.md),
[pixi migration plan](./runtime-box-pixi-migration.md).

---

## PROMPT

You are running on Windows, on a machine with an NVIDIA RTX 4060 Ti (compute 8.9, CUDA
12.4-capable). This is a **local, zero-cost hands-on spike**. Do not touch any CI, do not run
anything paid or remote, install everything **contained** under a scratch `PIXI_HOME`, and change
no production code. Read `.mind/roadmap/runtime-box-pixi-phase0-spike.md` and
`runtime-box-pixi-migration.md` first for context.

### The exact question you must answer
On macOS we proved a relocated conda-forge prefix imports the full scGPT dependency set with **no
activation environment at all**. macOS is the easy case (`@rpath`). **Windows is the real unknown:**
no rpath — DLLs (including CUDA/cuDNN) are found via `PATH` / `os.add_dll_directory`. The Rust
self-test launches the interpreter as `Command::new(python_path).args(["-c", script])` with **no
injected environment** (`run_self_test`, `src-tauri/src/bridge/runtime_boxes.rs`). So the question is:

> After packing a conda-forge env with conda-pack and extracting it to a **different absolute path**,
> does `venv\python.exe -c "import torch, anndata, numpy, scipy, pandas, h5py, tqdm"` succeed —
> and for the CUDA build, does a real CUDA tensor op run — when launched with **no conda
> activation, no `CONDA_PREFIX`, and the venv NOT on `PATH`**? If not, what is the **minimal**
> environment that makes it work?

Do this for **two targets: win-64 CPU and win-64 CUDA 12.4.** The CUDA one is the whole point.

### Setup (contained)
```powershell
$ROOT = "$env:TEMP\pixi-phase0-win"
New-Item -ItemType Directory -Force -Path $ROOT | Out-Null
$env:PIXI_HOME = "$ROOT\pixi"
$env:PIXI_NO_PATH_UPDATE = "1"
iwr -useb https://pixi.sh/install.ps1 | iex   # installs into $PIXI_HOME contained
& "$env:PIXI_HOME\bin\pixi.exe" --version
& "$env:PIXI_HOME\bin\pixi.exe" global install conda-pack
```

### Target A — win-64 CPU
`pixi.toml` (note: conda-forge names the framework **`pytorch`**, not `torch`):
```toml
[project]
name = "scgpt-phase0-win-cpu"
channels = ["conda-forge"]
platforms = ["win-64"]

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

### Target B — win-64 CUDA 12.4
Same as A, plus force the CUDA build. On conda-forge/pixi the lever is a CUDA system requirement,
which lets the solver pick the GPU-enabled `pytorch` build:
```toml
[project]
name = "scgpt-phase0-win-cuda"
channels = ["conda-forge"]
platforms = ["win-64"]

[system-requirements]
cuda = "12.4"

[dependencies]
python = "3.11.*"
pytorch = "2.8.0.*"
cuda-version = "12.4.*"
anndata = "*"
numpy = "*"
scipy = "*"
pandas = "*"
h5py = "*"
tqdm = "*"
```
After `pixi install`, **verify you actually got the CUDA build** (not the CPU fallback):
`pixi list | Select-String pytorch` — the build string must contain `cuda`, and
`conda-forge` must have shipped the CUDA runtime into the env (look for `venv\Library\bin\cudart64_*.dll`).
If the solver still picked the CPU build, pin the build string explicitly, e.g.
`pytorch = { version = "2.8.0.*", build = "cuda*" }`, and re-solve. The machine's NVIDIA driver
must be recent enough for CUDA 12.4 (R550+, e.g. driver ≥ 551.61); conda ships the CUDA runtime,
so only the **driver** must be current.

### For EACH target
1. `pixi install`, then locate the prefix: `.pixi\envs\default` (a real conda prefix; on Windows the
   interpreter is `python.exe` at the **root** of the prefix, i.e. `<prefix>\python.exe`).
2. Pack with conda-pack: `& "$env:PIXI_HOME\bin\conda-pack.exe" -p <prefix> -o $ROOT\pack.tar.gz --format tar.gz`
3. Extract to a **different absolute path**, into a dir named `venv` (mimic a real user location,
   include a space in the path, e.g. `C:\Program Files\Liatir Test\boxes\scgpt\venv`):
   `tar -xzf $ROOT\pack.tar.gz -C "<that venv dir>"` (Windows 10+ ships `tar`).
4. Run the embedded relocation fixer once, via the packed interpreter:
   `& "<venv>\python.exe" "<venv>\Scripts\conda-unpack.exe"` (or `...\Scripts\conda-unpack-script.py`).
5. **The faithful "no activation env" test.** Open a **fresh** PowerShell that has NOT activated any
   conda env and does NOT have `<venv>` on `PATH`. Confirm no leakage first:
   `$env:CONDA_PREFIX; $env:PATH -split ';' | Select-String 'venv'` (both should be empty). Then:
   ```powershell
   & "<venv>\python.exe" -c "import torch, anndata, numpy, scipy, pandas, h5py, tqdm; print('IMPORT OK', torch.__version__)"
   ```
   Record success/failure and the full traceback on failure (a Windows DLL failure looks like
   `OSError: [WinError 126] The specified module could not be found` / `fbgemm.dll` / a CUDA dll).
6. **CUDA compute proof** (target B only), same no-activation shell:
   ```powershell
   & "<venv>\python.exe" -c "import torch; print('cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '-'); x=torch.randn(512,512,device='cuda'); print('cuda matmul sum', float((x@x).sum()))"
   ```
7. **Rigor against silent fallback.** Rename the source `.pixi\envs\default` prefix aside and
   re-run step 5/6 from the extracted `venv`. It must still pass with the source gone.

### If the cold import (step 5/6) FAILS — find the MINIMAL activation env
Add candidates to `PATH` **one at a time, smallest first**, and re-test to find the minimal set:
`<venv>\Library\bin`, then `<venv>\Library\usr\bin`, `<venv>\Library\mingw-w64\bin`, `<venv>\bin`,
`<venv>\Scripts`, `<venv>` itself. Also test the in-process alternative
(`os.add_dll_directory(r"<venv>\Library\bin")` before `import torch`) since Rust could inject DLL
dirs per-process instead of mutating `PATH`. Report **exactly** which directories are required for
(a) CPU import and (b) CUDA import+compute — this is what the Rust run path would have to inject.

### Output (write it back into the repo)
Produce a decision-record fragment answering, for **CPU** and **CUDA** separately:
- Cold import works with NO activation env? (Y/N)
- If N: the **minimal** env (which `PATH` dirs, or which `add_dll_directory` calls).
- CUDA available + real compute works? (Y/N), GPU name, and that the CUDA build (not CPU) was used.
- Extracted prefix footprint (for the `diskPlan` floors).
Then update the **per-OS table** in `runtime-box-pixi-phase0-spike.md` and, if Windows needs an
activation env, confirm the Phase 2 design point: `LiatirRuntimeBoxReleaseManifest.activation` must
be **populated for win-64** (and the Rust `spawn_in_env`/`run_in_env`/self-test path must inject it
on Windows) while macOS stays `null`. Keep all spike artifacts contained; delete the multi-GB env
and packs when done (the record is the deliverable).

--- end PROMPT ---
