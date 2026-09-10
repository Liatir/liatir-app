# Adopting Scrollcase v3, and what it unblocks

Opened 2026-09-11. **Status: not started.** This is the prerequisite for Boltz-2 and both Protenix
variants, and it is a real migration rather than a version bump.

## Why this exists

Liatir pins exact `scrollcase@0.8.0`, which produces **version 2** boxes. Scrollcase released
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

1. **Scrollcase 1.x — declared PyPI licences.** A scroll may point at a reviewed inventory
   supplying the licence for distributions the lock does not declare, mirroring the existing
   `bundledLicenseDeclaration`. Liatir's reviewed input already exists:
   `runtime-boxes/legal/audits/boltz-2-linux-x86_64-cuda12.9-pypi.json`, produced by
   `scripts/runtime-box/pypi-license-inventory.py`.
2. **Liatir adopts Scrollcase 1.x.** Doing this after step 1 means migrating once, to a version
   that already carries what Boltz needs.
3. **Rebuild and republish the nine published boxes** as v3 artefacts. Separately authorized, and
   the reason this is not a quiet dependency bump.
4. **Then Boltz-2**: scroll, local build with a development key, `verify --self-test`, product
   runner, scientific validator, real inputs, measurements.

## What the format change touches in Liatir

From the Scrollcase 1.0.0 release notes, each of these is used across Liatir's eleven scrolls and
its three consumer surfaces:

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
