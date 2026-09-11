# Adopting Scrollcase v3, and what it unblocks

Opened 2026-09-11. **Status: the code is migrated and green, and every published box is rebuilt on
every platform.** One artefact is left — the macOS OpenMM target — and it is blocked on a signing
key, not on a build.

Done: `scrollcase@1.1.1` and `scrollcase-consumer 0.4.0` pinned, all 22 scrolls rewritten and
accepted by `audit`, the Rust bridge, the WSL2 consumer, the shared contract, every script, the
signer service, the registry worker and the whole test suite moved to the v3 shape.
`test:verify` passes 6/6 with 586 unit tests, `cargo test` 102, Clippy clean.

**Every box this machine can build is rebuilt as v3, eight of eight, with no failure** (2026-09-11):
`native-tools`, mhcflurry Linux CPU, pvactools Linux CPU, scGPT Linux CPU and CUDA, Geneformer
Linux CUDA, and both OpenMM Linux targets. Each passed its own self-test before it was signed,
which is the check that says the scroll is right; the science was not repeated, by the owner's
decision. They are development-key artefacts under `.runtime-box-dist/`, not publications.

**The five macOS boxes are rebuilt too, on a Mac** (2026-09-11): Geneformer, scGPT, UCE and
mhcflurry on `macos-aarch64-metal`, pvactools on `macos-aarch64-cpu`, plus the bundled
`native-tools`. Each passed its own self-test before it was signed, on the same terms as the Linux
set — the science was not repeated.

Not done: **the macOS OpenMM target**, which is the one box with no signing key under
`.runtime-box-local/keys/`. The v2 artefact still on disk is from 2026-09-08 and was signed
`liatir-openmm-development`, so the key exists somewhere — the Linux machine built both OpenMM Linux
targets — but not on this Mac. Minting a fresh one here would sign it under a different identity
from its Linux siblings, so it waits for the owner rather than being worked around.

## What the rebuilds cost, and why

Three defects stood between a migrated scroll and a built box, and every one of them fired *after*
the multi-gigabyte environment had been solved and packed:

1. **The build directory has to be on a Linux filesystem.** A conda compiler sysroot carries
   `xt_CONNMARK.h` beside `xt_connmark.h`; on the NTFS behind `/mnt/<drive>` those are one file, and
   conda-pack refuses with 205 packages reporting deleted contents. `SCROLLCASE_BUILD_DIR` moves
   only the extracted prefix.
2. **The Native Tools authoring inputs were the only hash-pinned files the scroll tree does not
   hold, and `.gitattributes` did not cover them**, so a Windows checkout delivered CRLF and the
   build stopped at a SHA-256 mismatch.
3. **A scroll's `pixiVersion` is not advisory.** Every model scroll pins 0.73.0 and `native-tools`
   pins 0.77.0; building with whichever pixi is on `PATH` is refused by name. The rebuild script
   reads the version from each scroll and installs that one.

Plus `--weights embed`, a flag version 3 removed rather than renamed.

**On macOS the binding constraint was disk, and UCE is why.** Every other box is between 138 MB and
554 MB packed; `uce-4layer` is **9.2 GB**, and building it needs roughly 20 GB of headroom — about
11 GB of scratch under `.rb/` on top of the archive it writes. A run that builds the set back to
back without clearing `.rb/` between boxes will exhaust a disk that looked comfortable when it
started, and the first symptom is not a build error: the machine stops being able to write
temporary files at all. Clear each box's scratch as soon as its release document exists. `.rb/` is
git-ignored scratch and Scrollcase recreates it; `.runtime-box-dist/` is the product and is not
disposable.

## Which machine rebuilds what

A box is built on the platform it is built *for*, and that is independent of how it is reached.
Windows users get a Linux payload through WSL2, but a macOS box exists because macOS users run one
natively — there is no WSL2 on a Mac.

| Platform | Published targets | Rebuilt where | Done |
| --- | ---: | --- | --- |
| Linux | 5 | this machine, inside WSL2 | ✅ all five, plus `native-tools` and both OpenMM targets |
| macOS | 5 | a Mac, natively | ✅ all five, plus `native-tools`; OpenMM waits for its key |

The three native Windows targets were **retired** on 2026-09-11 rather than rebuilt — see
[no native Windows Runtime Box targets](../../decisions/no-native-windows-runtime-box-targets.md).
Their Linux counterparts now declare `windows-wsl2` and carry those users, which is why all five
Linux targets do.

## What the migration actually touched

Beyond the field renames the guide lists, three things in Liatir turned out to hold a Scrollcase
document version of their own, and all three moved to 3 with the rest: the **signer service**
policy and its response envelope, the **registry worker**'s route validators, and the app's
`RUNTIME_BOX_SCHEMA_VERSION`, which is the only wire format the binary accepts.

That last one is the field-migration risk worth stating plainly: **an app built from this commit
refuses every box now in the field**, by name, and the registry will serve v3 documents once the
rebuilds land. The two have to ship together, or an installed app is left unable to read what it
already has. The v1→v2 cutover handled the same problem and is the precedent to follow.

Three Scrollcase gaps were found and fixed upstream on the way through, each by trying to build
something real rather than by reading: PyPI licences (`scrollcase@1.1.0`), a box that downloads an
archive and expands it, which **14 of the 22 scrolls** do (`scrollcase@1.1.1`), and an
**uncompressed `tar`** asset, which `assetArchives` did not accept at all
([scrollcase#14](https://github.com/suffro/scrollcase/pull/14), open).

That third one is why **Liatir's pin must move again before Boltz-2 can be built from a clean
checkout**: `scrollcase@1.1.1` refuses `"format": "tar"` by schema, and Boltz's 1.86 GB molecule
dictionary is published exactly that way. The box in `.runtime-box-dist` was built against the
merged fix from a local checkout.

## Why this exists

Liatir pinned exact `scrollcase@0.8.0`, which produces **version 2** boxes. Scrollcase released
`1.0.0` on 2026-09-02 with the **version 3** format — a deliberate breaking wire change, the only
one planned. A v3 verifier refuses a v2 box **by name** rather than reinterpreting it. There is no
dual-read path and no migration tool: *a box is rebuilt from its scroll*.

Liatir would have had to cross this eventually. What forced the schedule is that the three
remaining Phase 3 models are the project's only recipes with `[pypi-dependencies]`, and **pixi
records no licence for a PyPI package**, so no box containing one can be built at all today. The
fix belongs in Scrollcase, and by the owner's decision of 2026-09-11 it lands **only on the 1.x
line** — no backport to 0.8. Adoption therefore comes first.

Full evidence for the blocker is in [the Boltz source review](./phase3-boltz-source-review.md).

## Order of work

1. ✅ **Scrollcase 1.x — declared PyPI licences.** `pypiLicenseDeclaration` shipped in
   `scrollcase@1.1.0`. Liatir's reviewed input already exists:
   `runtime-boxes/legal/audits/boltz-2-linux-x86_64-cuda12.9-pypi.json`, produced by
   `scripts/runtime-box/pypi-license-inventory.py`.
2. ✅ **Liatir adopts Scrollcase 1.x.** Done in one pass, to a version that already carries what
   Boltz needs.
3. 🟡 **Rebuild every published box** as a v3 artefact, plus the bundled `native-tools` box.
   A rebuild is enough to prove the scroll: each model's science was already validated and does
   not need repeating, by the owner's decision of 2026-09-11. Eight done on Linux and Windows,
   six on macOS. Only the macOS OpenMM target is left, blocked on its signing key.
4. ⏳ **Republish**, together with an app build that can read v3. Separately authorized, and the
   reason this is not a quiet dependency bump.
5. ⏳ **Then Boltz-2**: scroll, local build with a development key, `verify --self-test`, product
   runner, scientific validator, real inputs, measurements.

## What the format change touches in Liatir

From the Scrollcase 1.0.0 release notes, each of these was used across Liatir's twenty-two scrolls
and its three consumer surfaces:

- `runtime: { id, version, entryPoint }` replaces `pythonVersion` and `pythonEntryPoint`, in the
  scroll, `box.json` and the signed release; `provenance.pythonVersion` becomes
  `provenance.runtimeVersion`.
- `modelId` and `runtimeId` are **removed**, replaced by an optional `labels` map Scrollcase never
  reads. Both are load-bearing identifiers in `runtime-boxes/catalog.json` and in the Rust bridge.
- `modelCacheSubdir` becomes `cacheSubdir`.
- `weights` is removed in favour of `assets[].embed` per entry; the `--weights` flag is gone.
- `assetBaseUrl` becomes `publishBaseUrl`, and a box may now carry no URL at all.
- `selfTest.pythonImports` generalises away from Python-specific syntax.

Three surfaces move together, as always: `src-tauri/src/bridge/*.rs`, `src-ts/`, and the shared
contract in `packages/liatir-core`. The installed-box state on a user's machine is v2 and must be
handled explicitly, exactly as the v1→v2 cutover did.

## Related

- [Boltz-2 source review](./phase3-boltz-source-review.md) — the blocker, with the evidence.
- [Scrollcase extraction](../../history/scrollcase-extraction-plan.md) — how Scrollcase became an
  independent project, and why adoption is downstream Liatir work.
- [Runtime Box ownership boundary](../../decisions/runtime-box-ownership-boundary.md) — what belongs
  to Scrollcase and what belongs here.
