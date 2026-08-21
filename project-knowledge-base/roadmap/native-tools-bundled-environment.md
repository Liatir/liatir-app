# Native Tools as one bundled environment

Status: **Decided 2026-08-20. Built and verified end to end on macOS arm64
2026-08-21. The Windows/WSL2 path is implemented and its logic is unit-tested,
but has not been executed on Windows.**

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

These are the feasibility figures. What shipped prunes a slightly different set —
`conda-meta` is kept, because it is the record of what is installed — and comes
to 202.7 MB and 68.0 MB; see [Implementation](#implementation-2026-08-21).

For scale, the macOS DMG was 19.7 MB before this, so the installer would land
around 90–100 MB. That is ordinary for a desktop scientific application and
nowhere near the several hundred megabytes that would have made this a hard call.
The built package came in at 87 MB.

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

Decided and applied 2026-08-21. The product invokes `bwa` and `bwa index`,
`dep-requirements.ts` declares `bwa` at `minVersion 0.7.17` pointing at
`lh3/bwa`, and conda provides `bwa` 0.7.19 on both supported platforms.
`binary-releases.ts` was the only place naming `bwa-mem2`, and since the file it
installed was called `bwa-mem2` while every caller asks for `bwa`, that managed
install could never resolve — a defect independent of this migration, now
removed. A contract test requires every key in `BINARY_RELEASES` to be a binary
the dependency catalogue declares, which is the property whose absence let the
entry sit there unreachable.

bwa-mem2 is two to three times faster on `mem`, but its index needs far more RAM
— tens of gigabytes for a human genome against a few for bwa. That is fine on a
cluster and disqualifying on the laptop this product targets. Choosing bwa also
changes nothing for existing pipelines, because it is already what they call.

If speed matters later, add bwa-mem2 as a separately named tool with its memory
requirement stated, never as a silent substitute for `bwa`.

## Implementation (2026-08-21)

### What builds it

`native-tools-env/pixi.toml` and `pixi.lock` are committed and cover `osx-arm64`
and `linux-64` in one manifest, so a tool cannot end up at a different version
depending on which installer a user downloaded. `npm run native-tools:build`
solves it frozen, copies it out of the pixi environment, prunes the build
artifacts, **runs every tool from that copy**, and only then emits one
`native-tools-<subdir>.tar.gz` plus a manifest sidecar recording the lock digest
and each pinned version. Neither is committed; both are produced by the build.

On macOS arm64 the whole thing takes 9 seconds and produces a 68.0 MB archive
holding a 202.7 MB environment, with `samtools` 1.24, `bcftools` 1.24, `seqkit`
2.13.0, `fastp` 1.3.6, `bwa` 0.7.19 and `minimap2` 2.31.

Verification is by execution, not inspection, because the question a bundle asks
of a conda prefix is precisely whether it still works somewhere other than where
it was built. Beyond `--version`, all six were run on the repository's own demo
files: `seqkit stats` reported 60 reads over 4,500 bp, `samtools faidx` indexed
four contigs, `bwa index` plus `bwa mem` produced 60 alignment records,
`minimap2 -ax sr` produced 60, and `fastp` wrote its trimmed FASTQ and reports —
first from the build directory, then again from a prefix extracted somewhere
else entirely.

### Why an archive and not a directory of files

The first implementation shipped the prefix as bundled resource files. The
resulting `.app` was **438 MB for a 203 MB environment**: the Tauri bundler
resolves symlinks into full copies, and a conda prefix has 1,140 of them.
`libicudata` was written twice at 33 MB, `libopenblas` seven times at 13.5 MB —
196 MB of duplication, and a 188 MB DMG.

Shipping one archive and unpacking it with `tar` keeps the symlinks, the execute
bits and the size, and makes all three platforms use the same mechanism instead
of one for macOS and Linux and another for Windows. Extraction of 212 MB takes
**1.0 second**, runs off the startup path so the first tool run does not pay for
it, and is keyed by lock digest so an update lands beside the old environment
rather than on top of one a running Job is using.

Measured on the rebuilt package: the `.app` went from 483 MB to **111 MB** and
the DMG from 188 MB to **87 MB**, against 19.7 MB before any of this — which is
the 68 MB archive and almost nothing else. The Gate 7 macOS package gate passes
unchanged, `codesign --verify --deep --strict` and `hdiutil verify` included.

The signature argument survives the change: the archive is inside the signed
application, and what is unpacked is derived from it. It is the same shape
Runtime Boxes already use for AI Models, and the same place — application data —
that they already extract to.

### What runs it

`resolve_spawn` in `src-tauri/src/bridge/jobs.rs` is the single choke point every
Native Tool passes through — the app's own runs and out-of-process plugins
alike — so preferring the bundle is one change in one place. Order is bundle,
then managed binary, then `PATH`; the bundle comes first because it is the build
the release was tested against, and preferring anything on the host would
reinstate the drift the bundle removes.

`lia_deps_check` answers for a bundled tool from the build manifest instead of
probing, so the Dependencies screen and every tool page show *Included with
Liatir* and a version rather than "Not installed" for a tool that works. Nothing
is executed to answer, which also keeps the Windows startup sweep from
triggering the first-run unpack.

`bridge/bwa.rs` and `bridge/minimap2.rs` spawn their tool directly rather than
through `lia_jobs_spawn`, and both now go through the same `resolve_spawn`. They
were the hole: reachable by plugins over the IPC server, they would have run a
host binary while everything else ran the bundled one, and on Windows they would
simply have failed.

The E2E that proved the managed-binary install was replaced rather than deleted.
It downloaded a checksummed SeqKit release and ran it, but both binaries the
managed registry can still offer are now inside the bundle, so its Install button
no longer exists. What replaces it proves the claim that now matters: a bare tool
name spawned through the shared Jobs backend runs the binary the application
shipped, at the version its manifest records, and the Dependencies screen says so.

### What the resolver order broke, and why it stays

Three pipeline-lifecycle tests failed the first time `test:ui` ran against the
bundle, and the cause is worth recording because it is the decision, working.
That suite registered four fake tools in `managed-bins/index.json` — `/bin/echo`
for seqkit, `sleep 30` for fastp, and two scripts printing a canned SAM and
flagstat — pointed at three files in `/tmp` that nothing in the repository ever
created. It passed for as long as somebody's `/tmp` happened to hold them.
Preferring the bundle made the fakes unreachable, the real tools ran, and they
correctly refused to open files that were not there.

The order was not changed to accommodate the test. A managed binary for a
bundled tool can now only be a leftover from an older release, and silently
preferring it is exactly the drift the bundle exists to remove. The suite writes
its own inputs instead: reads cut out of a generated reference so minimap2 has
something real to align, and one ~16 MB FASTQ sized so single-threaded fastp is
genuinely still running when the cancellation test asks. Cancelling a real
process beats cancelling a `sleep`, and the suite no longer depends on a
directory nobody owns.

On Windows this makes those three tests depend on WSL2 and on the `linux-64`
archive, which is a real new prerequisite for the Windows UI suite — and the
right one, since it is what will ship there.

### Windows

The Windows installer carries the `linux-64` archive and WSL2 unpacks it into the
Linux filesystem — not onto NTFS, and not run from `/mnt/c`: the symlinks and
execute bits do not survive the copy, and every library load across `/mnt/c` pays
the 9p filesystem cost. The unpack itself is a fixed shell program with every
value passed as a positional argument, so nothing a user controls becomes shell
source; the completion marker is written inside the tree before it is moved into
place, so an interrupted first run can never leave a half-extracted prefix that
looks ready.

Windows cannot build this artifact — only Linux can link a Linux conda prefix —
so `npm run native-tools:build` on Windows verifies the archive and its digest
instead of building, and fails the packaging gate if it is absent. Otherwise the
installer would look perfectly correct and ship an application with no tools at
all.

The WSL2 crossing now lives in `src-tauri/src/helpers/wsl.rs`, shared with
External Workflows rather than copied: which paths may leave Windows, how they
are translated, and how the translation is checked are exactly the details that
must not exist twice. Argument translation is deliberately narrow — an argument
is a file if it starts with a drive letter, which is what Liatir always passes
and what a `bcftools` filter expression never looks like.

**Not executed on Windows.** The command construction, the path-argument
selection and the mapping checks are unit-tested and run on every platform;
whether `wsl.exe` and `wslpath` behave as documented is not something a macOS
machine can answer. Two things need the Windows gate specifically: the first-run
unpack, and whether killing `wsl.exe` cancels the tool inside it. External
Workflows needed a token and a cancel program for that, but only because Nextflow
detaches itself; a Native Tool is a direct `--exec` child, which should make the
close of its pipes sufficient — should, not does.

## Still to settle

1. **The invariant.** AGENTS.md requires that heavy dependencies stay modular and
   installed on demand, and that nothing heavy becomes mandatory for a workflow
   that does not use it. At +68 MB compressed this reads as being about CUDA and
   PyTorch rather than about `samtools`, but the bundle does make these tools
   mandatory for every user, and that is a deliberate choice being made rather
   than overlooked.
2. **Signing.** The archive is inside the signed application, but what runs is
   unpacked into application data and is not itself signed or notarized. That is
   the same position Runtime Boxes are already in, and it is the
   [release gate](./release-signed-distribution.md)'s problem, not answered here.
3. **Retiring the old path.** `binary-releases.ts`, the managed-bin installer and
   the package-manager column of [the support matrix](./native-tool-support.md)
   are redundant wherever a bundle exists, but they are still the only path on
   macOS x86_64 and Linux ARM64. Deleting them waits on those two platforms
   getting an environment.
4. **Build reproducibility in CI.** The environment must be built by the three
   GPU-free hosted runner profiles already declared in
   `runtime-boxes/catalog.json` — `ubuntu-24.04`, `windows-2025`, `macos-15` —
   with the Linux job handing its archive to the Windows job. No self-hosted or
   GPU runner is involved.
5. **The platforms with no environment.** `osx-64` and `linux-aarch64` resolve to
   no bundle today, so tools there still fall through to `PATH`. Adding them is
   two entries in the same manifest plus a runner that can link them.
6. **SnpEff**, still unmeasured: it is Java, and its JRE would outweigh all six
   tools combined.
