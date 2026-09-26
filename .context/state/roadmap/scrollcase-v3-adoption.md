# Adopting Scrollcase v3, and what it unblocks

Opened 2026-09-11. **Status: the code is migrated and green, and every published box is rebuilt as
v3 on every platform.** Nothing is left to rebuild.

Done: `scrollcase@1.2.0` and `scrollcase-consumer 0.4.0` pinned, all 22 scrolls rewritten and
accepted by `audit`, the Rust bridge, the WSL2 consumer, the shared contract, every script, the
signer service, the registry worker and the whole test suite moved to the v3 shape.
`test:verify` passes 6/6 with 586 unit tests, `cargo test` 102, Clippy clean.

**Every box this machine can build is rebuilt as v3, eight of eight, with no failure** (2026-09-11):
`native-tools`, mhcflurry Linux CPU, pvactools Linux CPU, scGPT Linux CPU and CUDA, Geneformer
Linux CUDA, and both OpenMM Linux targets. Each passed its own self-test before it was signed,
which is the check that says the scroll is right; the science was not repeated, by the owner's
decision. They are development-key artefacts under `.runtime-box-dist/`, not publications.

**The macOS boxes are rebuilt too, seven of seven, with no failure** (2026-09-11): Geneformer,
scGPT, UCE and mhcflurry on `macos-aarch64-metal`, pvactools and OpenMM on `macos-aarch64-cpu`, plus
the bundled `native-tools`. Each passed its own self-test before it was signed, on the same terms as
the Linux set — the science was not repeated.

**The local signing keys are not all in one place, and assuming they are costs an hour.** Five boxes
have a per-box key in a directory named after the box. OpenMM does not: it signs with the key at the
*root* of the machine's local key directory, whose id is `liatir-openmm-development`. Looking only
in the per-box layout makes it read as a missing key, and turns a routine build into a blocked one.
Neither is a trust root — `runtime-boxes/trust/` holds those, `liatir-runtime-box-development-2026`
and `liatir-runtime-box-production-2026`, and they are the publication and CI identities rather than
what signs a local development artefact.

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
11 GB of scratch in the build directory on top of the archive it writes. A run that builds the set
back to back without clearing that scratch between boxes will exhaust a disk that looked comfortable
when it started, and the first symptom is not a build error: the machine stops being able to write
temporary files at all. Clear each box's scratch as soon as its release document exists. Scrollcase
recreates the build directory on demand and Git ignores it; the distribution directory it writes
releases into is the product, and is not disposable.

## Which machine rebuilds what

A box is built on the platform it is built *for*, and that is independent of how it is reached.
Windows users get a Linux payload through WSL2, but a macOS box exists because macOS users run one
natively — there is no WSL2 on a Mac.

| Platform | Published targets | Rebuilt where | Done |
| --- | ---: | --- | --- |
| Linux | 5 | this machine, inside WSL2 | ✅ all five, plus `native-tools` and both OpenMM targets |
| macOS | 5 | a Mac, natively | ✅ all five, plus `native-tools` and OpenMM |

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
**uncompressed `tar`** asset, which `assetArchives` did not accept at all (`scrollcase@1.2.0`, via
[PR #14](https://github.com/suffro/scrollcase/pull/14)).

**Liatir is pinned to `scrollcase@1.2.0`** as of 2026-09-12, and every authored scroll validates
against the published package — including Boltz's `"format": "tar"`, which is how its 1.86 GB
molecule dictionary is distributed.

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
3. ✅ **Rebuild every published box** as a v3 artefact, plus the bundled `native-tools` box.
   A rebuild is enough to prove the scroll: each model's science was already validated and does
   not need repeating, by the owner's decision of 2026-09-11. Eight on Linux and Windows, seven on
   macOS, no failure anywhere.
4. ⏳ **Republish**, together with an app build that can read v3. Separately authorized, and the
   reason this is not a quiet dependency bump. Authorized by the owner on 2026-09-24 (no users yet,
   so republishing is safe); the Linux boxes run from the Windows host's WSL2 self-hosted runner,
   the macOS boxes from the Mac, through the same `runtime-box-release.yml`. Old v2 objects on R2
   are removed only once all ten are v3. Linux, on `beta`:
   - ✅ `mhcflurry-class1-presentation` linux-x86_64-cpu — run 36017886905
   - ✅ `pvactools-pvacseq` linux-x86_64-cpu — run 36025526169
   - ✅ `scgpt-whole-human` linux-x86_64-cpu — run 36056702126
   - ✅ `scgpt-whole-human` linux-x86_64-cuda12.9 — run 36068289796
   - ✅ `geneformer-v1-10m` linux-x86_64-cuda12.9 — run 36074390654

   **Linux is done (2026-09-25).** macOS, on `beta`, from the Mac's ephemeral self-hosted runner:
   - ✅ `mhcflurry-class1-presentation` macos-aarch64-metal — run 36134812748
   - ✅ `pvactools-pvacseq` macos-aarch64-cpu — run 36168390892
   - ✅ `geneformer-v1-10m` macos-aarch64-metal — run 36171019826
   - ✅ `scgpt-whole-human` macos-aarch64-metal — run 36173142919
   - ✅ `uce-4layer` macos-aarch64-metal — run 36246477862

   **All ten are v3 on `beta` (2026-09-26).** What is left of this step is the app build that reads
   v3, and the R2 cleanup below.

   Then the old v2 objects on R2 go, which **needs a wrangler login with R2 write**: the Mac's
   OAuth token carries only `workers_scripts:write`, and `wrangler r2 object delete` answers 403.
   The list is rebuilt, not guessed — every release the catalog ever referenced but no longer does,
   its archive, and every object a failed release run uploaded, each confirmed present and none
   referenced by the catalog or by any channel the Registry serves. Six release documents stay:
   the revoked retired targets' channels still point at them, so only their archives go.

   The single-cell models had not been through the release workflow since August, and three
   things had drifted under them, each found by a failed run before promotion: the scGPT validator
   read the embedding by position after the product added two viewer columns (`034019b`); the
   release test build rejected any candidate it did not list, and a published model was not listed
   (`7b19e40`); and their lifecycle specs spawned the Job through the bridge, so no execution
   record owned it and it was never finalized into a Result. The scGPT and Geneformer specs now
   start the run from the model page, as a user does, through
   `runSingleCellEmbeddingFromModelPage`. **The UCE spec (macOS) still spawns through the bridge
   and will fail the same way**; it needs the same change before its republish.
5. ✅ **Then Boltz-2**: scroll, local build with a development key, `verify --self-test`, product
   runner, scientific validator, real inputs, measurements — all done on 2026-09-11. It predicts
   ubiquitin to 1.99 Å of the experimental structure from sequence alone. What it does **not** have
   is a product surface: no execution path in the app, so no Jobs or Results lifecycle, no catalog
   entry and no CI workflow. See [the Boltz source review](./phase3-boltz-source-review.md).

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
