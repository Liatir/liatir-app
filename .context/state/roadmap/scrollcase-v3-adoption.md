# Adopting Scrollcase v3, and what it unblocks

Opened 2026-09-11. **Status: the code is migrated and green; the boxes are not rebuilt yet.**

Done: `scrollcase@1.1.1` and `scrollcase-consumer 0.4.0` pinned, all 22 scrolls rewritten and
accepted by `audit`, the Rust bridge, the WSL2 consumer, the shared contract, every script, the
signer service, the registry worker and the whole test suite moved to the v3 shape.
`test:verify` passes 6/6 with 586 unit tests, `cargo test` 102, Clippy clean.

Not done: **the thirteen published boxes are still v2 artefacts** and must be rebuilt, and the
`native-tools` box bundled in the app must be rebuilt before `test:ui` can run.

## Which machine rebuilds what

A box is built on the platform it is built *for*, and that is independent of how it is reached.
Windows users get a Linux payload through WSL2, but a macOS box exists because macOS users run one
natively — there is no WSL2 on a Mac — and three Windows-native boxes remain published by the
owner's decision to leave shipped artefacts alone.

| Platform | Published targets | Rebuilt where |
| --- | ---: | --- |
| Linux | 5 | this machine, inside WSL2 |
| macOS | 5 | needs a Mac |

The three native Windows targets were **retired** on 2026-09-11 rather than rebuilt — see
[no native Windows Runtime Box targets](../../decisions/no-native-windows-runtime-box-targets.md).
Their Linux counterparts now declare `windows-wsl2` and carry those users.

The three Windows-native targets are `geneformer-v1-10m/windows-x86_64-cuda12.8`,
`scgpt-whole-human/windows-x86_64-cpu` and `scgpt-whole-human/windows-x86_64-cuda12.8`. Only two of
the published Linux targets declare `windows-wsl2` at all — mhcflurry and pvactools; the other three
serve Linux hosts.

## What the migration actually touched

Beyond the field renames the guide lists, three things in Liatir turned out to hold a Scrollcase
document version of their own, and all three moved to 3 with the rest: the **signer service**
policy and its response envelope, the **registry worker**'s route validators, and the app's
`RUNTIME_BOX_SCHEMA_VERSION`, which is the only wire format the binary accepts.

That last one is the field-migration risk worth stating plainly: **an app built from this commit
refuses every box now in the field**, by name, and the registry will serve v3 documents once the
rebuilds land. The two have to ship together, or an installed app is left unable to read what it
already has. The v1→v2 cutover handled the same problem and is the precedent to follow.

Two Scrollcase defects were found and fixed upstream on the way through: PyPI licences
(`scrollcase@1.1.0`) and a box that downloads an archive and expands it, which **14 of the 22
scrolls** do (`scrollcase@1.1.1`).

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
3. ⏳ **Rebuild the thirteen published boxes** as v3 artefacts, and the bundled `native-tools` box.
   A rebuild is enough to prove the scroll: each model's science was already validated and does
   not need repeating, by the owner's decision of 2026-09-11.
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
