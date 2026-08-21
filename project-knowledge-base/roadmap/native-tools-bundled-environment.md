# Native Tools as one bundled environment

Status: **Decided 2026-08-20. Feasibility measured on macOS arm64 2026-08-21;
implementation not started.**

## The decision

Every Native Tool ships **inside the app**, in a single relocatable environment
built from conda-forge and bioconda, one per operating system. A tool with no
package for a platform is simply not in that platform's bundle and is declared
unsupported there.

There is no catalog, no download, no per-tool signature and no revocation for
tools. Those exist for AI models because a model arrives *after* installation,
from outside. A tool that is already inside the signed application bundle is
covered by the application's own signature.

Scrollcase is not affected. It is an external builder Liatir uses; nothing about
its box format needs to change, because a bundled environment is not a
downloadable box — the app knows where its own resources are and does not have
to discover an entry point.

## Why

Liatir distributes executable dependencies three ways today: signed Runtime
Boxes for AI models, pinned upstream binaries in `binary-releases.ts`, and
"install it yourself with a package manager" for everything those cannot cover —
which is most tool and platform combinations. The third is not a distribution
mechanism, it is the absence of one, and it ends with an unverified binary on
the `PATH` that the resolver executes.

Bundling removes dependency management from the user's machine entirely, which
is the same reason Runtime Boxes exist for models.

## Measured on macOS arm64 (2026-08-21)

Six tools in one environment — `samtools`, `bcftools`, `seqkit`, `fastp`, `bwa`,
`minimap2` — solved and installed from conda-forge + bioconda for `osx-arm64`
with pixi 0.77.0. FastQC is excluded on purpose: it already ships as WASM in
`src-tauri/resources/wasm/fastqc.wasm`.

| | On disk | Compressed |
| --- | --- | --- |
| As solved | 265 MB | **80 MB** |
| Without `man`, `include`, `conda-meta`, `doc` | 222 MB | **71 MB** |

For scale, the current macOS DMG is 19.7 MB, so the installer would land around
90–100 MB. That is ordinary for a desktop scientific application and nowhere
near the several hundred megabytes that would have made this a hard call.

38 packages total, and the deduplication is real: `htslib` is present once and
serves both `samtools` and `bcftools`, which is the whole argument for one shared
environment instead of one box per tool. No Python interpreter is pulled in.

### Verified, not assumed

- All six binaries execute from a directory they were not built in, with no
  launcher repair and no activation step. This matches the pixi Phase 0 finding
  for macOS.
- Real work, not `--version`: `seqkit stats` reported 60 sequences over 4,500 bp
  on a demo FASTQ; `samtools faidx` produced a valid index of `chr1`/`chr2`;
  `minimap2 -ax sr` aligned the demo reads and emitted 60 SAM records.

### Where the size goes, if it ever needs trimming

| Item | Size | Pulled by |
| --- | --- | --- |
| `lib/libicudata` | 32 MB | `icu` |
| `bin/k8` | 30 MB | `k8`, minimap2's `paftools` JavaScript helper |
| `bin/seqkit` | 18 MB | `seqkit` itself (Go, statically linked) |
| `lib/libopenblas` | 13 MB | `libopenblas`, via the BLAS/GSL stack `bcftools` uses |

`man` and `include` alone are 37 MB of pure dead weight in a bundled
application. Beyond that, `k8` is only needed by `paftools`, which the product
does not currently call.

## What this replaces

- `binary-releases.ts` and the managed-bin install path.
- The package-manager column of [the support matrix](./native-tool-support.md).
- **STAR, bedtools and hisat2**, which are offered for installation today with
  zero references anywhere in the tool code. They are not in the bundle.

`snpeff` is deliberately out of this measurement: it is Java and would pull a
JRE that outweighs all six tools combined. Measure it separately before
deciding whether it belongs in the bundle or stays a separate install.

## Platform coverage, measured (2026-08-21)

The same solve was run per tool for each platform. conda-forge + bioconda:

| Tool | macOS arm64 | Linux x86_64 | Windows x86_64 |
| --- | --- | --- | --- |
| samtools | yes | yes | **no** |
| bcftools | yes | yes | **no** |
| seqkit | yes | yes | **no** |
| fastp | yes | yes | **no** |
| bwa | yes | yes | **no** |
| minimap2 | yes | yes | **no** |

Linux resolves all six. Windows resolves none — bioconda does not build for
`win-64` at all, as a channel policy, so this says nothing about whether a tool
could run on Windows.

That distinction matters, and upstream release pages settle it:

| Tool | Official Windows executable from its authors |
| --- | --- |
| seqkit | **yes** (`seqkit_windows_amd64.exe`) |
| fastp, minimap2, bwa, samtools, bcftools | no |

seqkit is Go, which cross-compiles to Windows for free. The other five are POSIX
C/C++ and use interfaces — `fork()` above all — that have no Windows equivalent,
maintained by very small teams whose users are on Linux clusters. There is no
Windows build to package because none exists.

### Windows strategy

Ship the **Linux** bundle on Windows and execute it through WSL2, the way Gate 6
already runs Nextflow: `liatir.exe -> wsl.exe -> the tool, inside Linux`. All six
tools exist on Linux, so all six work.

The maintainer accepts requiring WSL2, on the condition that installing it is
clearly documented wherever it is needed. That is the same prerequisite External
Workflows already carry, so it adds no new burden for users who already run
Nextflow.

The existing path mapping is sound and was reviewed rather than assumed. It calls
`wslpath -a -u` inside WSL instead of rewriting `C:\` into `/mnt/c` by string
substitution; rejects `\0`, `\r` and `\n` and non-absolute paths before
leaving Windows; feeds paths over stdin read with `IFS= read -r` so Windows/WSL
argument parsing can never split them; keeps the shell program fixed so no path
content becomes shell code; and on return requires the mapped count to equal the
input count with every result absolute, which is what prevents a silent
off-by-one mismapping between files.

### bwa: use the original, retire bwa-mem2

Decided 2026-08-21. The product invokes `bwa` and `bwa index`,
`dep-requirements.ts` declares `bwa` at `minVersion 0.7.17` pointing at
`lh3/bwa`, and conda provides `bwa` 0.7.19 on both supported platforms.
`binary-releases.ts` is the only place naming `bwa-mem2`, and since the file it
installs is called `bwa-mem2` while every caller asks for `bwa`, that managed
install is unlikely ever to resolve — a live defect today, independent of this
migration.

bwa-mem2 is two to three times faster on `mem`, but its index needs far more RAM
— tens of gigabytes for a human genome against a few for bwa. That is fine on a
cluster and disqualifying on the laptop this product targets. Choosing bwa also
changes nothing for existing pipelines, because it is already what they call.

If speed matters later, add bwa-mem2 as a separately named tool with its memory
requirement stated, never as a silent substitute for `bwa`.

## Still to settle

1. **The invariant.** AGENTS.md requires that heavy dependencies stay modular and
   installed on demand, and that nothing heavy becomes mandatory for a workflow
   that does not use it. At +71–80 MB this reads as being about CUDA and PyTorch
   rather than about `samtools`, but the bundle does make these tools mandatory
   for every user, and that is a deliberate choice being made rather than
   overlooked.
2. **The resolver.** The managed-bin/`PATH` resolver has to prefer the bundled
   environment. This crosses the bridge, `src-ts` and the frontend, and needs its
   own product lifecycle evidence through the shared Jobs backend.
3. **Build reproducibility.** The environment must be built from a committed
   `pixi.toml` + `pixi.lock` in CI, not by hand. The three GPU-free hosted runner
   profiles already declared in `runtime-boxes/catalog.json` —
   `ubuntu-24.04`, `windows-2025`, `macos-15` — are sufficient; no self-hosted or
   GPU runner is involved.
