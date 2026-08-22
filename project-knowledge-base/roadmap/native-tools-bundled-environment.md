# Native Tools as one bundled environment

Status: **Decided 2026-08-20. Built and verified end to end on macOS arm64
2026-08-21, and on Windows x86_64 through WSL2 the same day — every gate green
and all three Windows-only questions answered. Running the gate found four
defects, all fixed and covered: a CRLF checkout that broke the build and silently
changed the environment's identity; a build-time sysroot that doubled the
`linux-64` archive; a network path forwarded to the tool instead of refused; and
an unpack keyed on the lock rather than on the archive, which would have kept an
older release's environment in place.**

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
- **STAR, bedtools and hisat2**, which were offered for installation with zero
  references anywhere in the tool code. Removed from the catalogue 2026-08-22
  rather than bundled; see the note on RNA-seq below.

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
so on Windows the build script verifies the archive and its digest instead of
building. `npm run native-tools:build` only warns when it is missing, so a
developer running an unrelated end-to-end suite is not blocked on an artifact
only Linux can produce; `npm run native-tools:require`, which the packaging gates
call, fails. Otherwise the installer would look perfectly correct and ship an
application with no tools at all.

The WSL2 crossing now lives in `src-tauri/src/helpers/wsl.rs`, shared with
External Workflows rather than copied: which paths may leave Windows, how they
are translated, and how the translation is checked are exactly the details that
must not exist twice. Argument translation is deliberately narrow — an argument
is a file if it starts with a drive letter, which is what Liatir always passes
and what a `bcftools` filter expression never looks like.

**Executed on Windows 2026-08-21**, and `wsl.exe` and `wslpath` do behave as
documented. What the unit tests could already prove — command construction,
path-argument selection, the mapping checks — they proved on every platform;
what only Windows could answer is recorded below.

### Verified on Windows (2026-08-21)

Run on Windows 11 x86_64 with WSL2 and Ubuntu (`WSL_DISTRO_NAME=Ubuntu`), against
a `linux-64` archive built inside that same distribution. Everything below is
reproducible from a clean checkout.

**Prerequisites, as they actually landed.** WSL2 with an x86_64 distribution, and
`node` plus [pixi](https://pixi.sh) *inside* WSL. Nothing in this repository
installs pixi, so it is a separate step; once installed under `$HOME/.pixi`, the
build finds it without a `PATH` entry, through the fallback in `resolvePixi`. On
the Windows side the `*conf` scripts need Git for Windows and `jq` — and `jq` is
**not** part of Git for Windows, so that is a second separate install. The `bash`
on the Windows `PATH` is the WSL launcher, which `scripts/run-conf.mjs`
deliberately does not use.

**Build the archive inside WSL**, since Windows cannot:

```sh
wsl
cd /mnt/c/<path>/liatir-stack
node scripts/build-native-tools-env.mjs
```

It writes `src-tauri/resources/native-tools/native-tools-linux-64.tar.gz` and its
sidecar, and runs every tool from the destination prefix before packing, so its
output is already the first piece of evidence. `/mnt/c` makes the intermediate
copy slow — it dominated the run — and building from a clone in the Linux home
and copying the two files over is the faster route.

The first attempt **failed**, and the reason is the most valuable thing this gate
produced; see [the four defects](#the-four-defects-this-gate-found) below. After
that fix:

| | macOS `osx-arm64` | Windows `linux-64` |
| --- | --- | --- |
| Packages in the lock | 38 | 44 |
| Environment, pruned | 202.7 MB | 277.6 MB |
| Archive | 68.0 MB | 93.2 MB |
| Build wall time | 9 s | ~6 min |
| Installer | 87 MB DMG | 109.4 MB NSIS |
| First-run unpack | 1.0 s | 1.9 s |

Same six versions on both platforms — `samtools` 1.24, `bcftools` 1.24, `seqkit`
2.13.0, `fastp` 1.3.6, `bwa` 0.7.19, `minimap2` 2.31.

The `linux-64` figures are the ones **after** pruning the sysroot. As first built
it was 513.7 MB and a 152.0 MB archive, against macOS's 202.7 MB and 68.0 MB, and
the gap was worth chasing because it was not symlink duplication — 1,190 symlinks
survived into the tar and out again with no repeated payloads. It was one
package: the `linux-64` solve pulls `sysroot_linux-64` and `kernel-headers_linux-64`,
which `osx-arm64` has no equivalent of, and 215 MB of that was a single
`locale-archive.tmpl`. `ldd` resolves **zero** libraries out of that tree for any
of the six tools, so it is now in `PRUNE_DIRECTORIES` — see
[The four defects](#the-four-defects-this-gate-found).

**The gates, all green.**

| Gate | Result |
| --- | --- |
| `npm run test:verify` | 56 files / 338 tests passed |
| `npm run test:ui` | 5 passed / 0 failed / 2 platform-skipped; end-to-end **33 passed / 0 failed / 23 skipped** |
| `npm run desktop-beta:package:windows` | passed — 109.4 MB NSIS installer, silent install and uninstall, all three artifacts `NotSigned` as the gate requires |
| `npm run desktop-beta:test:windows` | passed — install, migration, restart recovery, uninstall retention |
| `cargo test` / `cargo clippy` | 79 passed / 0 failed / 2 ignored; clippy exits 0 |

That end-to-end line is identical to the macOS baseline. The five tests that
depend on this path all pass: three in `00-pipeline-lifecycle.e2e.mjs` (seqkit
attribution, fastp cancellation, minimap2-to-samtools), and the bundled-tool test
in `dependencies.e2e.mjs`, which sees `execution === 'wsl2'` here and now also
carries a path with a space and a refused network path. `native-tools:build` on
Windows correctly verified rather than built: *linux-64, executed through WSL2 —
archive 93.2 MB, digest verified*.

The pruned archive was also verified **natively on Linux**, inside the same WSL2
distribution: unpacked somewhere it was never built, `ldd` reports no missing
shared library for any of the six, and all six do real work — `seqkit stats` 60
sequences over 7,200 bp, `samtools faidx` 1 contig, `bwa mem` 60 records,
`minimap2 -ax sr` 60 records, `samtools flagstat` 60 in total, `fastp` 60 reads
written, `bcftools` 1.24. The build script runs on Linux and re-executes every
tool after pruning, so a wrong `PRUNE_DIRECTORIES` entry fails the build.

**The three questions, answered.**

1. *The first-run unpack — correct.* After the first launch,
   `$HOME/.local/share/liatir/native-tools/<archiveSha256>/bin/samtools` exists
   inside WSL with all six tools executable, **1,162 symlinks preserved**, the
   completion marker in place and no stray `.partial`. A second launch does not
   redo the work: the marker keeps the same inode and mtime across a full
   startup. Interrupting the unpack leaves a `.partial` tree — measured at 55 MB
   and 122 binaries with **no marker** — always under `.partial` and never under
   the final digest name, and the next launch discards it and unpacks cleanly.

   One thing to know: **killing the app does not stop the unpack.** `tar` was
   still running inside WSL after `liatir.exe` died and finished on its own eight
   seconds later. Harmless, because the unpack is idempotent and ends in a valid
   prefix, but the app is not the lifetime owner of that work.

2. *Cancellation — killing `wsl.exe` is enough.* Reproducing what
   `kill_job_blocking` does (piped stdio, `child.kill()` on the `wsl.exe` child)
   against a fastp with roughly ten seconds of work left on a 120 MB FASTQ: fastp
   was gone from `ps` inside WSL within one second, with no orphan. The
   end-to-end cancellation test passes and leaves no Native Tool process behind.
   So no token and no cancel program are needed here — Nextflow needed those only
   because it detaches itself, and a Native Tool is a direct `--exec` child.

3. *Path translation — spaces work; UNC did not refuse, and now does.*
   `C:\…\Nome Cognome\reads.fastq` arrived as `/mnt/c/…/Nome Cognome/reads.fastq`
   and seqkit read it: 40 sequences, 4,800 bp, exit 0, with the Job record
   keeping the original Windows path. That case is now asserted by the
   bundled-tool test rather than living only in this document.

   A UNC path was **not** refused as this section had required: it went through
   untranslated and failed inside Linux with
   `[ERRO] stat \\host\share\reads.fastq: no such file or directory`, status
   `failed`, exit 255 — visible rather than silent, but the refusal was the
   tool's, not Liatir's. Fixed; see the third defect below.

Do not change the resolution order to make a test pass, and do not switch a test
off to make the suite green: both would hide exactly what this gate exists to
find.

### The four defects this gate found

None of them could have been found any other way, and three were silent.

**1. A CRLF checkout broke the build and changed the environment's identity.**
`native-tools-env/pixi.lock` was not byte-pinned in `.gitattributes`, so a
Windows checkout under Git's default `core.autocrlf=true` materialised it with
CRLF line endings (`git ls-files --eol` reporting `i/lf w/crlf`). Two failures at
once, one loud and one silent:

- The build refused to start: `lockedVersions` finds a platform by the exact line
  `"      linux-64:"` after splitting on `\n`, and the trailing `\r` made that no
  match — *"pixi.lock has no linux-64 environment"*.
- **The lock digest changed**, from `e0bcda68…` to `cf090262…`, and at the time
  that digest named the directory the environment unpacks into. A Windows-built
  archive would have disagreed with the Linux and macOS one built from the
  identical lock.

Fixed with two lines in `.gitattributes`, next to the Runtime Box locks already
pinned for the same reason. A *tolerant parser* would have been the wrong fix: it
would have let the CRLF lock through and produced the wrong digest, which is the
worse half. `tests/unit/native-tools-environment.test.ts` now asserts the lock
and the manifest contain no `\r`; every other test in that file matches with
line-tolerant regexes and kept passing through both failures.

**2. The `linux-64` solve shipped 239 MB of build-time sysroot.** It pulls
`sysroot_linux-64` and `kernel-headers_linux-64`, which `osx-arm64` has no
equivalent of — 44 packages against 38. That was 264 MB of the 602 MB solved
prefix, 215 MB of it a single `locale-archive.tmpl`. `ldd` resolves **zero**
libraries out of that tree for any of the six tools. Adding
`x86_64-conda-linux-gnu` to `PRUNE_DIRECTORIES` took the archive from 152.0 MB to
**93.2 MB**, the prefix from 529 MB to 290 MB, the installer from 141.1 MB to
**109.4 MB**, and the first-run unpack from 4.8 s to 1.9 s. The entry is inert on
`osx-arm64`, which has no such directory. Verified natively on Linux as well as
through WSL2, because the same archive ships on both.

**3. A network path was forwarded to the tool instead of refused.** Covered in
question 3 above. `resolve` now rejects any argument beginning with two
backslashes before WSL2 is started at all:

> Liatir cannot open files from a network location on Windows:
> `\\server\share\reads.fastq`
> Copy the file to a drive on this computer, such as C:, and run the tool again.

Two leading backslashes is the whole test, deliberately: it is what a Windows
file picker produces for a network location, and no subcommand, flag, thread
count or `bcftools` filter expression begins that way. Two Rust unit tests cover
the refusal and the arguments that must keep passing; the Windows arm of the
bundled-tool E2E asserts the message reaches the caller. The comment on
`is_mappable_windows_path` in `helpers/wsl.rs` claimed this refusal already
happened — it was true only on the staged-path route — and now says which route
refuses where.

**4. The unpacked environment was named after the lock, not the archive.** The
lock pins tool *versions*; the archive is the bytes those versions were packed
into. Change what the build packs — pruning, layout — and the archive digest
moves while the lock digest does not. The completion marker of the older release
then stays in place under the same name, and **the application goes on running
the environment that release unpacked, never the one it shipped**: the drift the
bundle exists to remove, arriving from inside. Defect 2 is exactly that case, and
it was reproduced on this machine — the pruned archive was ignored until the old
directory was deleted by hand.

The unpack is now keyed on `archiveSha256`, which the build already recorded in
the sidecar and which `LiatirNativeToolsArchiveManifest` now declares. Observed
across the upgrade on Windows: `e0bcda68…` (lock) became `18266feb…` (archive),
and the old tree was removed. Removing it required a second fix — the Windows
unpack program had no equivalent of `prune_other_digests`, so every superseded
environment stayed in the Linux home for good, half a gigabyte at a time. That
was pre-existing and would have been triggered by every tool-version bump.

## Decided 2026-08-22

**SnpEff stays out, and Java stays the one dependency Liatir manages rather than
ships.** Bundling it means bundling a JRE, which would outweigh all six tools
combined for a tool most users never open — and SnpEff already keeps its
databases outside the application, so it was never going to be self-contained
anyway. Java therefore remains in `dep-requirements.ts` and on the Dependencies
screen, and it is now the *only* entry there that a user of a supported platform
can still be asked to install for a Native Tool.

**macOS x86_64 is not a target, ever.** Not "no environment yet": Intel Macs are
out of the product, and Apple silicon with Metal is the only macOS Liatir
supports. Nothing should be added to `osx-64` on any future pass.

**Linux ARM64 gets no environment, for want of an application rather than of
tools.** All six resolve on `linux-aarch64` at the identical versions — samtools
1.24, bcftools 1.24, seqkit 2.13.0, fastp 1.3.6, bwa 0.7.19, minimap2 2.31, in 41
packages — checked 2026-08-22. But Liatir ships three platforms, and Linux ARM64
is not one of them, so an environment there would be built for an application
that does not exist. Two lines in the same manifest if that ever changes.

Together those close the last hole in coverage: **every platform Liatir supports
now has a bundled environment.**

## RNA-seq is a vertical, not three more tools (2026-08-22)

STAR, hisat2 and bedtools were in the dependency catalogue and in nothing else.
The question of whether to bundle them instead of removing them was asked and
answered no, and the reasoning is worth keeping because it will come back.

Liatir already does single-cell RNA-seq — but it starts where RNA-seq ends. The
`.h5ad` files the AI Tools consume *are* the output of an RNA-seq pipeline: the
counts matrix. So the real gap is not "STAR is missing", it is that someone
holding raw reads cannot reach the point where the product's best feature begins.

Three measured facts about closing it, checked 2026-08-22 rather than recalled:

- **STAR cannot run on the target machine.** Indexing a human genome wants on the
  order of 30 GB of RAM, held while it works. This is the bwa-mem2 argument again,
  worse: fine on a cluster, disqualifying on a laptop.
- **hisat2 pulls a Python interpreter** into a bundle that deliberately has none.
  Solved alone: hisat2 20 packages *with* python, STAR 21 without, subread 2,
  bedtools 5. All four resolve on `osx-arm64` and `linux-64`.
- **Two aligners do not make an RNA-seq path.** Counting comes after alignment
  (`subread`), and differential expression after that — which is R and DESeq2,
  a language Liatir does not host at all. Bulk RNA-seq is its own vertical with
  its own downstream.

And the single-cell route is a different toolchain again: STARsolo (STAR, so the
same memory wall) or alevin-fry, which indexes the transcriptome rather than the
genome and should therefore fit in gigabytes rather than tens of them — unmeasured,
and the thing to measure first if this is ever taken up.

So: if RNA-seq becomes a direction, it is planned as a vertical the way the
single-cell lighthouse was, the aligner question is decided by memory rather than
by popularity, and the interesting target is the one that connects into the
AnnData path that already exists.

## Still to settle

1. **The invariant.** AGENTS.md requires that heavy dependencies stay modular and
   installed on demand, and that nothing heavy becomes mandatory for a workflow
   that does not use it. At +68 MB compressed this reads as being about CUDA and
   PyTorch rather than about `samtools`, but the bundle does make these tools
   mandatory for every user, and that is a deliberate choice being made rather
   than overlooked. On Windows and Linux the figure is +93 MB rather than +68 MB.
2. **Signing.** The archive is inside the signed application, but what runs is
   unpacked into application data and is not itself signed or notarized. That is
   the same position Runtime Boxes are already in, and it is the
   [release gate](./release-signed-distribution.md)'s problem, not answered here.
3. **Retiring the old path — done 2026-08-22.** `binary-releases.ts`,
   `binary-manager.ts`, the `managedBins` store, four bridge commands and the
   Dependencies-screen install UI are deleted, and `resolve_spawn` no longer
   consults a managed-bin registry. What survives is the native downloader, which
   viewer runtimes, SnpEff databases, Runtime Boxes and the generic download
   store all still use; its resume-and-cancel contract moved to where it is
   implemented. STAR, hisat2 and bedtools left `dep-requirements.ts` the same
   day: the Dependencies screen was asking users to install three programs no
   code in the application could run, which to a non-technical user reads as
   missing pieces blocking their work.

   That left `wrongToolPatterns` and `homebrewLinkConflict` — and therefore both
   dependency resolvers — with no subject, because STAR was the only requirement
   using either. They are kept, with the reason written where the list is now
   empty: the hazard is real and recurring, `java` being the obvious next case,
   and populating it needs patterns matched against real `--version` output
   rather than guessed. If that is not done, deleting the subsystem is the
   correct alternative; leaving it unexplained is not.
4. **The Linux application has not been gated with the bundle.** The `linux-64`
   archive is verified: built, pruned, and every tool run from a prefix extracted
   somewhere it was not built, natively on Linux. What has not run is Liatir
   *itself* on Linux with the environment inside it — `test:ui`,
   `desktop-beta:package:linux`, `desktop-beta:test:linux`. The code path there
   is the native one macOS already proves, not the WSL2 one, so the risk is low
   rather than absent; AppImage is the interesting case, since its resources live
   in a read-only mount while the unpack goes to application data.
5. **CI produces the archives** (`.github/workflows/native-tools-box.yml`), on
   `ubuntu-24.04` and `macos-15`, triggered manually or when the environment's
   inputs change. There is no Windows job because there is nothing for it to
   build: the `linux-64` artifact is the Windows input. What is still missing is
   a desktop release pipeline for those artifacts to feed — today the packaging
   gates are run by hand, so the archive is downloaded or built locally.
