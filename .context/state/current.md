# Current project status

## Liatir runs on Scrollcase v3 (2026-09-11)

The code migration is complete and green: `scrollcase@1.1.1` and `scrollcase-consumer 0.4.0`,
**all 22 scrolls** rewritten and accepted by `audit`, and the Rust bridge, the WSL2 consumer, the
shared contract, every script, the signer service, the registry worker and the whole test suite
moved to the v3 shape. `test:verify` 6/6 with 586 unit tests, `cargo test` 102 passed, Clippy
clean.

**Every box this machine can build is rebuilt: eight of eight, no failure** — `native-tools`,
mhcflurry Linux CPU, pvactools Linux CPU, scGPT Linux CPU and CUDA, Geneformer Linux CUDA, and both
OpenMM Linux targets. Each passed its own self-test before signing, which is what proves the scroll;
the science was not repeated. The five macOS boxes need a Mac.

**App and boxes have to ship together.** An app built from this commit accepts only v3 and refuses
every box in the field *by name*; the registry serves v3 once the rebuilds are published. That is
the v1→v2 cutover again. The plan, every field it touched, and the three defects the rebuilds
uncovered are in [Adopting Scrollcase v3](./roadmap/scrollcase-v3-adoption.md).

Getting here needed **two upstream fixes**, both found by migrating rather than by reading: PyPI
licences, which pixi never records (`scrollcase@1.1.0`), and a box that downloads an archive and
expands it — refused since 1.0.0 because no Scrollcase example does it, while **14 of Liatir's 22
scrolls** do (`scrollcase@1.1.1`). A third fix is open upstream: the npm publish workflow has
never worked, and both releases so far went out by hand.

## The home page leads with what is actually distinctive (2026-09-11)

The public home page sold native speed, privacy and extensibility. Two of those are true and one —
extensibility — is potential rather than a differentiator today, because a plugin system is worth
its ecosystem and the templates are still toy examples. The three pillars are now **private by
design**, **models that simply install**, and **everything speaks one language**, and the capability
grid names the Nextflow handoff and the MCP boundary explicitly.

The second pillar is the one the product was underselling. Model weights are public and free;
installing them is the day of work, and delivering them as signed, verifiable, revocable packages
that install in one click and run offline is the rare part. The third is the answer to "isn't this
just aggregation": a bundle of installers is aggregation, one contract that native tools, AI models,
plugins, API calls and Nextflow all obey is what makes any step feed any other — and what lets an
assistant drive the whole thing.

**A claim was removed rather than rewritten**: the AI card promised structure prediction and variant
scoring, which are not built. Boltz-2 and Protenix are open Phase 3 work, so the page now says what
runs today and that a family is added only once it is validated end to end.

The copy lived in both `HomePage.vue` and `HomePage.released.vue`, which is how a released page ships
last year's promises. It is now one `home-content.ts` that both read, with the icon set in one
`HomeIcon.vue`: 52 lines added, 220 removed. Both components were compiled, not only the active one.

## Connecting a client to Local MCP is now one copy (2026-09-11)

Settings showed a URL and a bearer token and stopped there. The **Connect a client** panel now
writes the configuration itself — Claude Code, Claude Desktop, Cursor, VS Code, or the three plain
facts any other client needs — generated from the live endpoint, with the token masked on screen and
copied in full. The recipes are data in `frontend/src/lib/mcp/clients.ts`, their shapes were read
from each vendor's documentation rather than recalled, and `tests/unit/mcp-client-recipes.test.ts`
pins them.

**A hosted assistant cannot connect, and the panel says so.** ChatGPT on the web and anything else
running on someone else's servers has no route to 127.0.0.1; that is the boundary working, not a
missing integration, and per-vendor plugins were rejected for the same reason. See
[Connecting a client to Local MCP](../decisions/mcp-client-connection.md).

Verified on macOS arm64: `test:verify` 6/6 suites, 78 files / 601 unit tests. The UI profile has not
been re-run for this panel.

## Boltz-2 is blocked on where a PyPI licence is written down (2026-09-11)

All three remaining Phase 3 models — Boltz-2 and both Protenix variants — are the only recipes in
the project with `[pypi-dependencies]`; every box published so far is pure conda. That difference
turns out to stop them at the licence inventory, before any build.

**pixi records an SPDX licence for a conda package and none at all for a PyPI one** (verified on
0.73.0 and 0.77.0, which resolve the same set). Scrollcase derives the box's inventory from the lock
and rightly refuses to ship a package whose licence it cannot name, so it throws on all 51 of
Boltz's PyPI entries. `scrollcase@1.0.0` behaves identically, and its new *declared* inventory is
for dependencies compiled into shipped binaries, not PyPI distributions. A catalog entry is
blocked too, since the catalog validator compares against that same refusing function.

**The licences themselves are now known.** All 144 locked distributions were reviewed: the PyPI half
by downloading each distribution the lock pins, checking its SHA-256, and reading its own metadata
(`scripts/runtime-box/pypi-license-inventory.py` →
`runtime-boxes/legal/audits/boltz-2-linux-x86_64-cuda12.9-pypi.json`). That file is the input any
fix needs. The legal record is `runtime-boxes/legal/boltz-2.md`, and it is **not approved**, for two
independent reasons: `frozendict==2.4.7` is LGPL-3.0-or-later — the first copyleft dependency this
project has encountered, and no policy exists for one — and `mols.tar`, 1.86 GB of molecule
definitions, carries no licence beyond the model repository's blanket `mit` with its upstream
provenance unstated.

**Decided 2026-09-11: the fix goes in Scrollcase, on the 1.x line only.** Scrollcase owns the
inventory contract and will take a project-declared file the same way it already takes
`bundledLicenseDeclaration`. No backport to the 0.8 line Liatir currently pins, which means
**Liatir must adopt Scrollcase v3 first** — a breaking wire change that also requires rebuilding and
republishing the thirteen boxes already in the field. The order of work, and every format field it
touches, are in [Adopting Scrollcase v3](./roadmap/scrollcase-v3-adoption.md); the blocker's
evidence is in [the Boltz source review](./roadmap/phase3-boltz-source-review.md).

Also decided the same day: a copyleft dependency **may** ship in a signed box when it travels as a
replaceable, unmodified package with its licence text — see
[Copyleft dependencies in signed boxes](../decisions/copyleft-dependencies-in-signed-boxes.md).
That closes one of the two legal questions; `mols.tar`'s provenance stays open.

## MCP file permissions scale past a handful of files (2026-09-10)

The MCP Settings surface offered one Allow/Revoke button per registered file in a scrollable list,
with no filter and no bulk action: correct, and unusable at real workspace sizes. It now has a
filter over the file list, a bulk allow bound to the filtered list and labelled with the exact
number of files it will change, a per-folder standing grant, and a revoke-all that clears every
file and folder grant in the workspace in one write.

**The one control that was asked for and deliberately not built is a global "allow new files by
default" toggle**, because it grants authority over files the user has not seen and leaves no
authorization event in the audit. The folder grant replaces it with a named, visible, revocable
scope; the Data root is not grantable, since with nested coverage it would be the same toggle under
another name. The reasoning is in
[MCP Data access controls](../decisions/mcp-data-access-controls.md).

Three native commands carry the bulk work — `lia_mcp_set_data_files_allowed`,
`lia_mcp_set_data_folder_allowed`, `lia_mcp_revoke_all_data_access` — so a bulk change is one atomic
configuration write and one audit record instead of N round trips through the single-file command.
The folder coverage rule is exported from `packages/liatir-core` and mirrored in Rust.

Verified on macOS arm64: `test:verify` 6/6 suites, 77 files / 596 unit tests; `cargo test` 102
passed / 2 ignored; Clippy clean at the existing warning baseline. The native Tauri E2E was run for
this change (`--suite tauri-prepare --suite tauri-e2e`): 35 passed, 0 failed, 30 environment-skipped,
including the Gate 8 MCP scenario, which drives the rewritten Settings rows through the real app and
asserts the `data-file-allowed` and `data-file-revoked` audit actions the shared bulk path now emits.
The remaining UI suites (packaging and install lifecycle) were not run; they do not touch this
change.

## OpenMM CUDA is validated in CI, not just locally (2026-09-10)

`openmm-openmm/linux-x86_64-cuda12.9` is **`native-lifecycle-validated`** — the first CUDA target
this project has ever taken past `planned`. Run
[34514107583](https://github.com/Liatir/liatir-stack/actions/runs/34514107583) built the box from
committed bytes on this machine's GPU through GitHub Actions and passed every stage: build
(330.5 s), signature and self-test, the scientific validator (86.3 s, reference parity
0.00017122510064382368 kJ/mol against a 0.01 limit), and the Rust product lifecycle. Archive
`9f9fd9e2f0d5c637be0358a2e8672b583c126b57dd0cc015b80260e4023413ea`, commit `2383642`, clean tree,
peak VRAM 185,597,952 bytes by device-wide delta on an RTX 4060 Ti (8,585,740,288 bytes,
capability 8.9, driver 610.62).

It took three dispatches, and the two failures were both real contract defects rather than flakes:

1. **The VRAM sampler failed on WSL2's own answer.** `nvidia-smi --query-compute-apps` lists the
   calling process with `[N/A]` once a CUDA context exists, and nothing at all before — two shapes
   of the same "not attributable", of which the code knew only one. Probed directly against a live
   context, then folded into the existing device-wide fallback. See
   [How VRAM is measured](../decisions/vram-measurement-method.md).
2. **OpenMM's GPU evidence named only half the card.** The evidence contract requires memory and
   compute capability, cross-checked against CI's own host probe; the validator reported model and
   driver alone. The measuring process now reads all four itself, deliberately as a separate query
   so the cross-check stays a real one.

A third, smaller one was cleared before the first dispatch: the Linux product-dependency script
asked for root unconditionally, which fails on a prepared self-hosted host that withholds
passwordless sudo.

**`linux-x86_64-cpu` followed on the first attempt**, run
[34515765891](https://github.com/Liatir/liatir-stack/actions/runs/34515765891) — same machine, no
GPU involved, 22 m 40 s, archive
`bf92d7a1877139f757fb019e0f743f290fd654f22d224dc0c93086c11ee7d764`, parity
0.0000632175252945899 kJ/mol, peak RAM 663,326,720 bytes. It is the target that serves a WSL2 user
without an NVIDIA card, and it is now `native-lifecycle-validated` too. That both CI legs of the
Windows-through-WSL2 story are green is what makes the earlier local evidence reproducible rather
than anecdotal.

`macos-aarch64-cpu` is the only OpenMM target still `planned`; it needs a hosted macOS runner,
which is paid and separately decided.

The published hardware envelope still comes from the retained 2026-09-09 local measurement and is
unchanged; publication remains a separate, unauthorized step.

## This machine is now the project's Linux self-hosted runner (2026-09-10)

The owner's Windows/WSL2 machine carries both self-hosted Linux runner labels, and the owner has
authorized its runs standing, without asking before each one. `openmm-openmm/linux-x86_64-cpu` and
`openmm-openmm/linux-x86_64-cuda12.9` are switched to `nativeCiEnabled: true`;
`macos-aarch64-cpu` stays off because it runs on a paid hosted macOS runner. The runner is
ephemeral — one job, then it deregisters and deletes its work root — so there is no standing
connection to keep alive. Rationale, the exact two-command sequence, and what was rejected are in
[Linux GPU CI runs on the owner's machine](../decisions/linux-gpu-ci-on-the-owner-machine.md).

Every remaining Phase 3 component is a Linux CUDA payload, so until today none of them could leave
`planned` for want of a machine, not for want of sources.

## OpenMM on the GPU works in the real app, from Windows through WSL2 (2026-09-10)

The first GPU product evidence in this project, and the first Windows-through-WSL2 proof for a
Phase 3 component. The release-candidate app installed the signed CUDA box into WSL2 and ran it:
**2 passed, 0 failed**. Host environment `windows-wsl2`, accelerator **CUDA**, a real relaxation of
the box's own `test-ala-3.pdb` taking the potential energy from −1.6910709302007945 to
−119.11212442123042 kJ/mol — a reduction of 117.42105349102962. Install, killed-Job cancellation,
both reachable hardware states on one input, the Job, the Result with four artifacts, provenance,
navigation, removal, and artifacts surviving removal all passed. Retained:
`openmm-linux-x86_64-cuda12.9-product-lifecycle-development-2026-09-10.json`.

**Five real gates stood between a working GPU and a working product, and none was a test artifact.**
Each was a refusal a Windows user with an NVIDIA card would have hit, invisible until a machine
existed that could reach this path. In order: the app routed only CPU payloads through WSL2; the GPU
probe asked Windows instead of the distribution; that probe used `wsl.exe --exec`, which never
searches `/usr/lib/wsl/lib` where WSL2 keeps `nvidia-smi`, so a working GPU looked absent; the WSL2
consumer hardcoded `linux-x86_64-cpu`; and a validator introduced here rejected the underscore in
`x86_64`. All five are fixed, with the reasoning in the
[Phase 3 status](./roadmap/phase3-implementation-status.md#openmm-cuda-passes-its-product-lifecycle-in-the-real-app-through-wsl2-2026-09-10).

The consumer's `runtime-install` argument list gained the target id, so
`src-tauri/resources/native-tools/native-tools-box-consumer` must be rebuilt for Linux musl inside
WSL2 (`rustup target add x86_64-unknown-linux-musl`). It is a build artifact, never committed, and
the app verifies it against a hash computed at compile time.

**Molecular Dynamics now has a product lifecycle too**, on the same install — it was the last
Phase 3 tool without one. Run `40a90eb1-f463-40e8-a3a7-00fc94e1e53b`, 10 result artifacts, 10 saved
frames, finite trajectory coordinates. It runs with hydrogens off because that is the configuration
the retained dynamics envelope actually covers: the default preparation bound of 165 atoms is beyond
every no-solvent dynamics sample, and ticking the acknowledgement would have made the leg green
while running outside all measurement.

Signing used the machine's local development key through `LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE`,
which only debug builds honour; `runtime-boxes/trust/` was not touched. This remains development
evidence: a production CI build makes a different archive and must be measured and exercised there.

Gates, run serially and never overlapping: `test:verify` passed all six suites — 583 tests, zero
failed, report `2026-09-10T13-50-55-463Z`. `test:ui` passed 35 native scenarios with zero failures
and 30 platform- or candidate-only skips, plus every companion suite and the Windows app
install/migration/restart/uninstall lifecycle. Rust passed 98
tests with 2 heavy fixtures ignored and Clippy reported no errors — the first time the Rust suite
has compiled on Windows, after two of its tests were found calling functions the platform compiles
out. `syngraphe check` reports no problems.

## OpenMM ran on a GPU, for the first time ever (2026-09-09)

Every OpenMM number this project had was Apple M1 CPU. `openmm-linux-x86_64-cuda12.9` is now built,
signed, self-tested and scientifically validated on a real NVIDIA GPU inside WSL2. Its build-time
self-test reported `{"platform": "CUDA", "status": "passed"}`, an independent
`runtime-box verify --self-test` passed on a fresh extraction, and the scientific validator passed
**18 cases — 13 real runs and 5 required refusals** — against the same signed payload it measured.
Reference parity held to 0.00017122510064382368 kJ/mol against a 0.01 limit. Archive
`54d8e87d8e026638ab23b4c4feb6cb9d3df25a58e200c1f436ac64464e929cbc`; retained measurement
`openmm-linux-x86_64-cuda12.9-development-2026-09-09.json`. Local execution is not CI and no
workflow was dispatched.

Two measured results that change what we can promise. **The GPU is nine to fourteen times faster on
the production shape**: solvated DHFR at 29,419 atoms relaxed in 14.1 s against 121.5 s on the M1,
and its 10 ps of dynamics took 13.7 s against 197.1 s. And **VRAM is not the constraint** — the
heaviest case peaked at 185 MiB on an 8,188 MiB card, because OpenMM's GPU cost here is dominated by
the CUDA context rather than the system size. That is a fact about OpenMM on this hardware and says
nothing about Boltz-2 or Protenix, neither of which has ever run.

That first CUDA run also exposed a real defect in the shared measurement helper: `nvidia-smi`
reports no per-process GPU memory at all under WSL2 — silently, with exit code 0 — so a genuine GPU
run looked identical to one that never touched the card. Per-process measurement is unchanged where
the driver supports it, so existing scGPT and Geneformer evidence stays valid; a labelled
device-wide fallback covers the rest. Sampling also went from 200 ms to 50 ms, which was too coarse
on every host, not only this one. See
[how VRAM is measured](../decisions/vram-measurement-method.md).

The owner confirmed the method the same day, so **the CUDA envelope is registered**:
`openmm-8.5.1-beta.1-linux-x86_64-cuda12.9-development-2026-09-09`, transcribed from the retained
measurement, publishing a minimum of 242,483,200 bytes and a recommended 290,979,840 from its
193,986,560-byte peak. Solvated DHFR at 29,419 atoms now sits inside a measured envelope on GPU and
runs with no acknowledgement. The pinning test compares samples byte-for-byte and pins those three
figures; both halves were observed failing on one altered byte.

Gate: `npm run test:verify` passed all six suites — 76 files passed, 1 skipped; 582 tests passed,
10 skipped, zero failed; report `2026-09-09T14-42-03-395Z`. `syngraphe check` reports no problems.

**Still open before publication.** This build is development-signed from a dirty tree, so it is not
publication evidence: a production CI build makes a different archive and must be re-measured and
re-exercised there. The CUDA product lifecycle has not run in the real app, and Molecular Dynamics
still has no product lifecycle on any target. GPU CI and publication each need the owner's separate
explicit authorization, which this session did not have and did not use.

### What is verified on this machine, and what is not

OpenMM only. Verifying it proved the *route* — a Windows app running a Linux GPU payload through
WSL2 — but every component still has to walk it with its own package, dependencies and scientific
test. Nothing else has been executed here.

| Component | Reality |
| --- | --- |
| `openmm-openmm` | both Linux targets are `native-lifecycle-validated` in CI on this machine; macOS CPU built, measured and product-proven locally but still `planned` |
| `jwohlwend-boltz-2` | dependency lock and complete licence inventory; legal record open on two points; blocked before any build on where a PyPI licence is expressed |
| `bytedance-protenix-v2` | nothing, and the official checkpoint still returns HTTP 403 |
| `bytedance-protenix-mini-default-v0-5-0` | nothing |
| `openvax-mhcflurry-class1-presentation` | published for macOS Metal and Linux CPU; its CUDA target is `planned` and unbuilt |
| `griffithlab-pvactools-pvacseq` | published for macOS CPU and Linux CPU |
| Geneformer, scGPT, UCE | published earlier from other machines; untouched and unverified here |

This machine now serves as the GPU runner on demand, which is what unblocked the CUDA target; see
[Linux GPU CI runs on the owner's machine](../decisions/linux-gpu-ci-on-the-owner-machine.md).
Publication is still a separate step from validation and still unauthorized: OpenMM
`macos-aarch64-cpu` remains the nearest one, because it
[runs on hosted CI](../decisions/runtime-box-publication-runs-on-hosted-ci.md) and needs no GPU
machine at all.

## Windows is an app host, not a payload platform (2026-09-09)

Owner decision: **no new Runtime Box target may be native Windows.** The desktop app is native
Windows; the scientific payloads it runs are Linux boxes executed inside WSL2. Windows support now
lives on the Linux target, as `hostEnvironments: ["native", "windows-wsl2"]` in both the catalog
entry and the signed scroll, which must match exactly. MHCflurry and pVACseq already worked this
way; it is now the rule. Every component from here on is developed for Linux x86_64 and
Windows-through-WSL2, plus **macOS where that is possible** — worth having, never owed, and absent
without apology when upstream dependencies do not exist there. Rationale and what was rejected:
[No native Windows Runtime Box targets](../decisions/no-native-windows-runtime-box-targets.md).

Applied: the four `planned` native Windows targets — MHCflurry `windows-x86_64-cpu` and
`windows-x86_64-cuda12.8`, OpenMM `windows-x86_64-cpu` and `windows-x86_64-cuda12.9` — are deleted
with their scrolls, locks, licence audits, signer-policy entries and workflow references. None was
ever built or signed, so nothing is withdrawn. Three unbuilt Linux targets gained `windows-wsl2`:
both OpenMM Linux targets and MHCflurry `linux-x86_64-cuda12.9`. `runtime-box:catalog:check` passes
and two new guards in `runtime-box-ci-catalog.test.ts` pin the rule, both observed failing first.

Evidence: `npm run test:verify` passed all six suites on this Windows host — 76 files passed,
1 skipped; 581 tests passed, 10 skipped, zero failed; report `2026-09-09T12-09-33-168Z`. The signer
policy's own 16 tests pass, and `syngraphe check` reports no problems. `test:ui` was not run: no UI,
navigation or Job/Result code changed. Nothing was committed, dispatched, signed or published.

One consequence worth recording: the `socket.AF_UNIX` defect found on 2026-09-08 in OpenMM's
`deny_network()` is now **unreachable, not fixed**. That code only ever runs on macOS, Linux or
Linux inside WSL2, all of which define the attribute. No correction is owed.

**The three already-published native Windows targets stay**, by the owner's decision in the same
conversation: Geneformer `windows-x86_64-cuda12.8`, scGPT `windows-x86_64-cpu` and scGPT
`windows-x86_64-cuda12.8`. They are signed and installable; withdrawing them would take a working
box away from those users and give nothing back until three new signed Linux releases carried
`windows-wsl2`. The rule stops new native Windows work, it does not undo shipped work. Their
catalog entries, scrolls, signer-policy entries and evidence are untouched, and the guard pins
exactly this list so a fourth is rejected.

## Boltz-2's lock is resolved, on the first machine that can run it (2026-09-08)

Boltz-2, Protenix v2 and Protenix Mini run only on Linux x86_64 with NVIDIA. Every prior session
worked from an Apple M1, where none of them could even be resolved, let alone executed. The
maintainer's Windows 11 desktop, through WSL2, is the first host in this project that can, and it is
now both the authoring host for their locks and the host their hardware measurements will come from.
Its exact specification is recorded in the
[Phase 3 status](./roadmap/phase3-implementation-status.md#the-linux-cuda-authoring-and-measurement-host-2026-09-08):
Ubuntu 26.04 in WSL2, 6 CPUs, RTX 4060 Ti with **8 GiB VRAM**, driver 610.62, 32 GiB host RAM
(WSL2 ceiling raised from the 50 % default to 24 GiB plus 16 GiB swap), 893 GiB free on the Linux
filesystem. VRAM is physical and cannot be raised; whether 8 GiB is enough for a realistic complex
is a question for measurement, not estimate.

`runtime-boxes/scrolls/boltz-2/linux-x86_64-cuda12.9/pixi.lock` now exists —
`f1e4a595010fe5c2d98e103c0b6b77ee8a80408ea80e25c661df29b2c4a1e88f`, against the unchanged reviewed
manifest `9a9ce69316b8b122288bfca10d4c397ca7bf096b5c2c64b05e088690cdacc6ec`. It was produced by
pixi 0.73.0 running the same `pixi lock` / `pixi lock --check` pair as the manual authoring workflow;
running locally on a Linux host is not CI, and no workflow was dispatched. **This is dependency
resolution and nothing more**: nothing installed, no model weight downloaded, no GPU execution, no
publication. `fairscale==0.4.13`, which ships only as source and was the exact macOS blocker,
resolved from its sdist. No upstream constraint was loosened.

Three graph findings are recorded for the runner and the legal inventory rather than fixed now:
Boltz hard-requires the `wandb` telemetry client and `sentry-sdk`, so the runner must neutralise
both; its one loose bound, `pandas>=2.2.2`, resolved to the major-version `pandas 3.0.5`, to be
settled by the offline self-test rather than pre-emptively pinned; and `fsspec` no longer exposes the
`http` extra, so `aiohttp` is absent. Details in the
[Boltz source review](./roadmap/phase3-boltz-source-review.md).

Boltz-2 still has no scroll, self-test, legal record, catalog entry, signer-policy entry, product
runner, scientific validator or measurement — and Protenix v2 and Mini have not been resolved yet.
Protenix v2's official checkpoint was last observed returning HTTP 403. No Phase 3 component is
published or visible in the normal product catalog.

This was the first `test:verify` ever run on Windows, and it failed — nine tests, all in
`tests/unit/openmm-product-script.test.ts`, none caused by the lock. Both underlying defects are now
closed by the 2026-09-09 host-target decision rather than by patching: that suite exercises the
OpenMM product script against a native Windows interpreter, a configuration the product no longer
has, and it is skipped on `win32` with the contract stated at the top of the file. It still runs in
full on macOS and Linux. Details:
[Phase 3 status](./roadmap/phase3-implementation-status.md#two-defects-the-windows-host-exposed-both-now-closed-2026-09-08-resolved-2026-09-09).

## The memory moved to `.context/` and is managed with Syngraphe (2026-09-07)

`.mind` is deleted. Everything it held is in `.context/`, which is now the
project's only memory, initialized and checked by
[Syngraphe](https://syngraphe.dev) — the small Git-native tool that keeps a
repository's context versioned and verifiable. No content was dropped; the
documents were placed by lifecycle rather than by topic:

- `.context/truth/` — the architecture entry point and its deeper documents, the
  `window.Liatir` and Rust command surfaces, the AI boundaries, the testing
  strategy, and the agent working agreements (now `.context/truth/agents/`, no longer a
  dot-directory, so they render in the site alongside everything else).
- `.context/state/` — `current.md` is this document, unchanged in content and complete;
  `.context/state/roadmap/` holds the fourteen plans and ledgers that are still live.
- `.context/decisions/` — the pixi relocation/activation decision record, and the
  Runtime Box ownership boundary, which had been buried in the old index.
- `.context/history/` — the thirteen records that declare themselves complete, closed or
  superseded, including every gate evidence document.

`AGENTS.md` carries a Syngraphe-managed block pointing at `.context/index.md`,
and a root `CLAUDE.md` imports `AGENTS.md`. **Run `syngraphe check` before
completing substantial work**: it fails on a context document that references a
path which does not exist, and warns when this document goes stale behind the
repository. It is offline, deterministic and needs no AI.

Two things were deliberately left alone. The five
`runtime-boxes/scrolls/**/pixi.toml` comments still name `project-knowledge-base`
for the same reason as before — a scroll's bytes determine its `sourceRevision`,
and a stale comment is cheaper than re-signing. And the 2026-08-24 entry below
still says `.mind`, because that is what happened on that date.

## Phase 3 pushed-commit audit (2026-09-07)

GitHub readback of `82137e7706ecd783590fc321dd2c392b85dcdfdd` found all four Runtime Box
preflights successful on `ubuntu-24.04`, with their native jobs skipped: OpenMM `34063716252`,
MHCflurry `34063716199`, pVACtools `34063716260`, UCE `34063716348`. SDK sync `34063715872`
also passed. Scheduled CI `34098675990` passed its verify and Rust jobs, but its advisory ESLint
job failed on an unnecessary type assertion in `packages/liatir-core/src/external-workflows.ts:300`.
The manual dependency workflow is on main but **not dispatch-ready**: GitHub recorded invalid-workflow
failure `34063715213` on push, with zero jobs. Its job-level `env` uses the unsupported `runner`
context at lines 32 and 34. Fix and statically validate that workflow before any dependency dispatch;
the earlier default-branch blocker is superseded. No fixes, dispatches or deployments were performed
in this audit. Runner inventory was independently confirmed empty. The pre-existing untracked
`AGENT-POLICY.md` was read and preserved; no AGENTS-POLICY.md exists.

No Phase 3 component is ready for publication. OpenMM still needs practical workload measurements,
Molecular Dynamics in the real app, remaining per-platform evidence and production signing/builds.
Its authored Windows targets are native Windows, not WSL2; its Linux catalog entries authorize only
native hosts. Boltz-2 and both Protenix models still lack complete packages/runners
and scientific/product evidence; v2 official checkpoint access was last observed denied.
(Boltz-2's lock was resolved on 2026-09-08; both Protenix locks are still unresolved.) Their
current candidate environments are Linux CUDA, not established macOS or Windows+WSL2 support.
See the [updated audit and release checklist](./roadmap/phase3-implementation-status.md#github-audit-2026-09-07).
Production build/publication requires fresh owner approval in this continuation, and GPU CI requires
separate explicit approval. R2 writes remain GitHub-Actions-only.
Local `test:verify` passed all six suites / 567 tests, report `2026-09-07T14-45-29-324Z`.
Only memory documents changed; UI/lifecycle tests were not repeated and neither diagnosed code
defect is corrected by this verification.

## Structure and simulation Phase 3 is in progress (2026-09-06)

Two plan corrections landed on 2026-09-07, both owner decisions, both recorded in
[the plan](./roadmap/new-ai-models-integration-plan.md#host-targets-and-hardware-limits--corrected-2026-09-07):
Boltz-2, Protenix v2 and Protenix Mini target only Linux x86_64 with NVIDIA, native or Windows
through WSL2, with no macOS effort; and the hardware gate must warn and take one explicit
confirmation above the measured envelope instead of refusing, with a hard refusal only above the
host's usable physical memory. The second is **not implemented**: the code still refuses, which with
OpenMM's 33-atom macOS envelope means every realistic protein is rejected today. Evidence is also now
required per declared host environment rather than per payload, so native Linux and
Windows-through-WSL2 are two separate proofs of the same signed box.

The Phase 2 Linux/WSL2 closure below remains the published product state. Phase 3 has candidate-only
contracts and initial OpenMM product code plus five locked recipes; no Phase 3 component is released.
The local macOS OpenMM development-signed payload passed 13 scientific/negative cases, and the
general verification passed 555 tests after the complex-input guards. Cross-platform validation,
product lifecycle, other Phase 3
models and publication remain unfinished; these local results do not close the phase.
The [implementation checklist](./roadmap/phase3-implementation-status.md) records verified work,
scientific defects found during the continuation and every remaining release gate.
Boltz-2 source and model revisions are now pinned in its source review. Its candidate dependency
manifest needs Linux-side resolution for source-only dependencies; no Boltz package is built yet.
Structure and affinity candidate routes own saved input drafts by workspace and draft ID, and the
serial UI gate now passes those rendered editor and candidate checks: 37 native scenarios, zero
failures (report `2026-09-06T21-25-49-220Z`), after the paired verification `2026-09-06T21-24-16-023Z`.
OpenMM is now measured on real proteins on macOS: dihydrofolate reductase at 2,489 atoms, that same
protein with the approved drug ruxolitinib bound to it at 2,530 atoms, and the protein in explicit
water at 29,419 atoms for both relaxation and 10 ps of dynamics — the real production shape — in
343–349 MiB and two to four minutes on an Apple M1. The drug case is the one that changed the
picture: an arbitrary molecule costs 576 MiB against the protein's 110 MiB, because parameterizing
it loads the charge model. Every structure and molecule ships inside the signed payload, so the
envelope grew with no downloaded asset, and the scientific and product evidence share one archive.
A membrane system (`apoa1`) is refused for chemistry, not size: amber19 has no lipid parameters.
Still unmeasured, and recorded as such: nanosecond durations, sizes above ~30,000 atoms, and every
GPU target.

The retained macOS CPU measurement is a registered run envelope, and the corrected hardware rule is
now implemented: inside it Molecular Relaxation runs on measured figures, past it the screen says the
run is larger than anything measured and runs only after one explicit acknowledgement, and the single
size refusal is a floor above the machine's installed memory. OpenMM is a CI catalog component with
five `planned` targets, a caller workflow, a signer-policy entry and a product lifecycle spec.
**Its macOS CPU product lifecycle passes in the real app** — install, cancellation, both reachable
hardware states on the same input, a real relaxation reducing potential energy by 117.92 kJ/mol,
Jobs, Results, provenance, navigation and removal with artifacts preserved — retained as
`runtime-boxes/measurements/openmm-macos-aarch64-cpu-product-lifecycle-development-2026-09-09.json`.
That is the first real Phase 3 product evidence, on a development-signed local build; it is not
publication evidence. No signer deploy, no CI dispatch and no publication happened.
Protenix v2 and exact Mini Default have separate candidate inputs and Linux manifests at source
commit `2475421477ab414b571149ad4a875c390ff8a35d`. Official v2 checkpoint access currently returns
HTTP 403; Mini metadata is readable, but no weights or byte hashes have been obtained. See the
[Protenix review](./roadmap/phase3-protenix-source-review.md). One shared Linux CPU-only lock-authoring
workflow now covers Boltz-2 and both Protenix components; it has not been dispatched, and cannot be
until it reaches the default branch. Scientific runners, hardware limits for realistic input sizes,
complete per-component product lifecycles and production publication remain open.
All three model components, and OpenMM's `linux-x86_64-cuda12.9` target, now need a Linux x86_64
host with an NVIDIA GPU — Windows with WSL2 counts as one, and after the 2026-09-09 decision it is
the only way Windows reaches them. The brief for that session is the
[Linux + NVIDIA handoff](./roadmap/phase3-linux-nvidia-handoff.md).

## Oncology Phase 2 Linux and WSL2 expansion is complete (2026-09-02)

MHCflurry and pVACseq are now published and exposed for native Linux x86_64 CPU and for the native
Windows x86_64 app through WSL2, in addition to their existing macOS targets. The app selects the
same signed Linux payload for both host environments; there is no parallel Windows build and no CUDA
claim.

The final exact-commit chain used commit `0f21ddb29d4667ad2e9d260cc60901a0af82fa92` throughout.
Native Tools run `33561232291` passed first. MHCflurry Windows/WSL2 run `33561608102` then passed
install, replacement, rollback, cancellation, real offline inference, Jobs, navigation-safe Results,
provenance, experimental-disclaimer, removal and byte-identical Result preservation. Its analysis run
is `744bc569-d2eb-4a2d-9735-aa68f1d43c96`; three Result artifacts survived removal. Compact evidence
artifact `9822458638` has digest
`sha256:8dfb11207845bfb3f1aa3f73d3658767486b522e9d4b12831cf06273c39fd123`.

pVACtools Windows/WSL2 run `33564921577` passed the same lifecycle plus the reduced official pVACseq
fixture. Its analysis run is `07bf2105-f0d2-4faf-8fcc-a8a3ae3798b9`; all six declared Result files
survived removal and the former `MHC_Class_I` directory is no longer misregistered as a file. Compact
evidence artifact `9823743568` has digest
`sha256:744e7c76a7deadca487ffa516295498d17865a685f4334e4767bb8a4f3e44e9f`.
Both Windows ephemeral runners passed their disk preflight, used explicit roots on `E:`, removed their
credentials and roots, and left the repository runner inventory empty.

The signed Linux publications remain the reviewed MHCflurry `2.2.1-beta.2` release `33462667589` and
pVACtools `7.1.2-beta.2` release `33464208587`. Their checked-in evidence and catalog publication
records are the source of truth for public release URLs, signed host compatibility and complete
archive hashes. The following paragraphs retain the diagnosis and retry history that led to this
closure.

The first final Windows `test:ui` attempt passed the 35-scenario main desktop suite, catalog
visibility, Native Tools, the single-cell index and SnpEff lifecycles, and the two-process pipeline
restart lifecycle. It then stopped in the Runtime Box security fixture because that old assertion
expected the POSIX directory names `tool-runtimes` and `ai-runtimes` on Windows. Since commit
`5d35592f`, the documented Windows path-length contract removes the `-runtimes` suffix and uses
`tool` and `ai`; the observed install path was therefore correct. The E2E now verifies the exact
platform-specific root plus runtime ID. Its 63 focused tests passed, followed by the final
`test:verify`: 70 files / 494 tests, SDK type generation, Core build, zero-warning Svelte check,
frontend build and `src-ts` compile. The one bounded `test:ui` retry then passed all seven applicable
suite groups with two host-inapplicable skips. Its main native suite passed 35 scenarios with no
failures, and the separate index, SnpEff, pipeline-restart, Runtime Box security and Windows desktop
install/migration/restart/uninstall-retention lifecycles all passed.

MHCflurry Linux CPU release `33397148921` passed at exact commit
`9c002d2f672cd3995ca74d115b0b09e47f7d6fac`. pVACtools release `33456282626` passed at exact commit
`7c651d0625bd0bb1d4ceff72c6a1c8300489bcaf` after the first-install timeout was made size-aware and
covered by regression tests. Both workflows passed KMS signing, self-test, scientific validation,
the full native product lifecycle, promotion and public readback; independent reads also verified
both signed channel/release documents and streamed each complete public archive to its expected
SHA-256 hash. Failed pVACtools run `33397199542` remains the recorded diagnosis: it published only
immutable objects, never promoted its channel, and stopped while a healthy first install reached the
old fixed timeout. The Linux payloads are published, but the product catalogs remain macOS-only until
both exact-commit Windows/WSL2 lifecycle proofs pass.

The first Windows/WSL2 proof, MHCflurry run `33458591342`, failed before downloading either box:
the pinned Rust composite action selected Windows' WSL launcher at `C:\Windows\System32\bash.exe`,
which stripped the backslashes from the runner work path. The runner and marked root were removed.
The bounded correction selects `C:\Program Files\Git\bin\bash.exe` through `GITHUB_PATH` before the
action, matching the already proven Windows release workflows. A new WSL2 attempt requires its
regression test, full `test:verify`, clean push and a fresh successful Native Tools run from the new
exact commit.

After that setup correction passed on the real runner, MHCflurry WSL2 run `33459261959` reached the
Windows Rust build and exposed a separate ownership error in `native_tools.rs`: the verified archive
digest was moved into the WSL2 consumer arguments and then reused to record the verified resource.
No payload install or inference started. The bounded correction passes a clone to the consumer and
keeps the original digest for process state. Another attempt requires the focused regression, a real
Windows Rust compile, full `test:verify`, clean push and another exact-commit Native Tools run.

With both setup defects corrected, MHCflurry WSL2 run `33461036295` built the real Windows app and
reached the first install. It then correctly refused the signed Linux `2.2.1-beta.1` release because
that immutable release predates the explicit `compatibility.hostEnvironments` field and therefore
cannot authorize the separate WSL2 execution boundary. The existing successful native releases are
not changed or rerun. New MHCflurry `2.2.1-beta.2` and pVACtools `7.1.2-beta.2` Linux CPU releases
will carry `['native', 'windows-wsl2']` in the signed document; catalog validation now requires every
authored target's signed host environments to match its reviewed catalog entry.

Those replacement publications are now complete. MHCflurry `2.2.1-beta.2` release
`33462667589` and pVACtools `7.1.2-beta.2` release `33464208587` both passed at exact commit
`f37be317e0b64eeafe963831e81ec6ad3d2c444b`: clean build, KMS signature, native self-test,
scientific validation, real Linux product lifecycle, immutable publication and beta promotion.
Independent public reads verified both channel and release signatures, the signed
`['native', 'windows-wsl2']` compatibility, and the complete archive hashes
`f9444985f6fc5163625dea1fddac50121522bec5d3a29461180f5708c3452227` (MHCflurry) and
`1fcca89636801592c6f3da5414f88988bfbca84eeccf9b48878e0b2ff5daa0db` (pVACtools).
The retained native analysis run IDs are `582083da-e4f9-46ca-ac56-dd25aaf6c9e7` and
`a3c763af-354d-4ec5-ab58-f8800d85d03b`. Product exposure remains blocked until both exact-commit
Windows/WSL2 lifecycle workflows pass with one newly built Native Tools box.

Native Tools run `33518455571` passed at exact commit
`ff3184f704b99ec2bcc4352311bcc37a2d98c06d`. MHCflurry Windows/WSL2 lifecycle run
`33518815450` then passed every assertion at that commit, with analysis run
`db0f0f72-0d24-48b6-bd61-d67a1ed3658d` and three Result artifacts surviving removal. The following
pVACtools run `33522895351` failed only because its size-aware install wait expired after 320 seconds:
there was no install error, and progress had reached 1,161,379,840 of 1,167,379,910 bytes. Its runner
and partial payload were removed. Root cause: the shared wait included native verification and
extraction overhead but not the extra Windows-to-WSL2 boundary. The bounded correction gives only
`windows-wsl2` a 360-second fixed allowance, propagates the already computed host environment through
both oncology specs, and regresses the exact measured pVACtools size. Cheap focused checks and full
`test:verify` passed (70 files / 491 tests). The next bounded steps are a clean push, one fresh
exact-commit Native Tools build, then one new MHCflurry-to-pVACtools proof pair using that same Native
Tools run. Any further pVACtools failure stops the retry for a new diagnosis.

That corrected pair reached a new boundary at exact commit
`604cb2cbeaa7edb3ce8d0ead8307c0eeae53ac69`. Native Tools run `33526400474` passed, and MHCflurry
Windows/WSL2 run `33526724084` passed the complete lifecycle with analysis run
`0104b919-1fc0-4dc3-afb4-42832335f0c3` and three preserved Result artifacts. pVACtools run
`33530623525` then completed install, replacement, rollback, cancellation, the real offline pVACseq
inference, Jobs, Results, provenance, navigation and removal, but the final test failed at its generic
`file size > 0` assertion. The retained screenshot shows the completed Result and its six registered
outputs. Root cause: non-empty is not the preservation contract; a valid scientific output may be
empty, as the existing zero-candidate regression already requires, and that assertion neither
compared the artifact before and after removal nor named the failing file. The bounded correction
snapshots every Result artifact's size and SHA-256 before removal and requires the exact same snapshot
afterward. Its regression must accept a preserved empty file and detect changed bytes. One corrected
pair retry is allowed only after focused tests, full `test:verify`, clean push, a fresh exact-commit
Native Tools build and fresh runner preflights; any different failure stops again for diagnosis.

At exact correction commit `80c623e0950181f5b11e059c3303f50b7c7e4ea5`, Native Tools run
`33553202219` passed and MHCflurry Windows/WSL2 run `33553513312` passed the complete lifecycle with
analysis run `af36e9f6-4ae2-4b6c-b5e9-d4c12bb3eca0`, three byte-identical Result artifacts and
compact artifact `9819547610` (`sha256:4dfad75cd188ef4b7420e4f04dc9ea05b924508f76a442f5fce429555e24aa32`).
pVACtools run `33557362572` again completed the scientific lifecycle but the improved preservation
check identified the exact remaining defect before removal: `EISDIR` while hashing an entry recorded
as a file. Root cause is the run-output enumerator reading `isDir`, while the direct Tauri bridge
serializes the Rust `FsEntry.is_dir` field as `is_dir`; consequently the pVACseq `MHC_Class_I`
subdirectory was added to `outputFiles` as an undeclared file with size zero. The correction consumes
the actual bridge field and regression-tests that a nested directory is excluded while its sibling
file is retained. One new exact-commit proof pair is allowed only after that regression, full
`test:verify`, clean push, fresh Native Tools and fresh runner preflights. No product target is exposed
until both workflows pass.

The product owner explicitly authorized protected production publication and active product-catalog
exposure for the validated MHCflurry `macos-aarch64-metal` and pVACseq `macos-aarch64-cpu` targets.
The same authorization applies to future Runtime Boxes only after their exact legal, build,
scientific, native and packaged-product lifecycle gates pass. It does not waive the separate explicit
approval required for paid GPU CI, and it does not permit publishing planned or unvalidated targets.
Every publication still requires the protected KMS signer, immutable public objects, independent
public readback and retained evidence before the app catalog can expose it.

Release attempt `33248936657` reached the new macOS packaged-product lifecycle after its clean
signed build, native self-test, scientific Metal parity and immutable public-hash verification had
passed. It stopped before beta promotion because the E2E helper checked for the Sandbox button once,
while the native bridge can become ready before Svelte renders that button. Public readback confirmed
the beta channel remained HTTP 404; only content-addressed immutable objects exist. The correction
waits for either the workspace shell or the rendered chooser, adds a delayed-render regression test,
and retains bounded screenshot and Tauri-log diagnostics on future failures. One fresh MHCflurry
release retry is allowed after the focused tests, full `test:verify`, clean push and runner preflight.

Retry `33249639926` proved that chooser correction and completed candidate installation, but the
retained screenshot exposed the next closed boundary: the normal app catalog correctly rendered
`Runtime not published`, so the pre-publication test binary could not reach the MHCflurry input form.
The release test build therefore needs one explicit candidate ID. Core owns the exact prepared
metadata and target; the frontend includes it only when that build-only ID is set, rejects unknown
IDs, and normal distributable builds remain unchanged. The same generic boundary covers the pVACseq
Tool Runtime. No further remote attempt is allowed until its focused contract test, full
`test:verify`, and a local candidate-built UI smoke have passed.

The candidate boundary's focused contracts passed (98 tests), frontend checking reported zero
errors or warnings, and the locally compiled MHCflurry candidate app passed the dedicated UI smoke:
it rendered `Install required` instead of `Runtime not published` without changing the normal product
catalog. The remaining local stop condition is the full `test:verify` gate before a clean push and
one fresh remote release attempt. That gate then passed all 70 test files and 482 tests, regenerated
the SDK types, built Core and the frontend, and compiled the TypeScript bridge.

Release run `33250827268` then passed clean signing, native self-test, Metal scientific parity,
immutable publication, the candidate visibility smoke and the real app build. It stopped before
promotion when the MHCflurry lifecycle opened its file picker: the retained screenshot proves the
requested file was visible, but both oncology specs had copied WebdriverIO's `button*=text` syntax
while Liatir's embedded harness accepts standard CSS selectors only. The correction is one shared
picker helper that enumerates real `button` elements and matches visible text, used by MHCflurry and
pVACseq. Its behavioral regression, spec-loading checks and full `test:verify` must pass before one
bounded MHCflurry retry; any further failure stops publication for a new diagnosis. The beta channel
was not promoted. Those gates now pass: 78 focused tests, then all 70 test files and 483 tests, SDK
type regeneration, Core/frontend builds and bridge compilation. The bounded retry is permitted after
the clean fix commit is pushed and the runner preflight passes again.

Retry `33262145841` proved the shared file-picker correction: candidate visibility, file selection,
signing, native self-test, scientific parity, immutable publication and the real app build all passed.
The lifecycle then reached its Run-button readiness check and exposed one more missing operation in
Liatir's intentionally small WebDriver client: both oncology specs call `isEnabled()`, but the client
did not implement the standard element-enabled endpoint. The complete MHCflurry and pVACseq specs
were audited and use no other missing element methods. Add that endpoint with a regression tied to
both routed specs, repeat focused checks and `test:verify`, then permit one new bounded MHCflurry
attempt; another failure requires a fresh diagnosis before any retry. Promotion did not run. The
endpoint regression and all routed-spec checks now pass (79 focused tests), followed by the full 70
test files and 484 tests, SDK regeneration, Core/frontend builds and bridge compilation.

Retry `33266824095` then passed candidate visibility, signing, native self-test, Metal scientific
parity, immutable publication, installation, cancellation, file selection and the real MHCflurry
inference. It stopped before promotion only when the E2E tried to inspect the completed Result with
`lia_app_read_text`: that command reads isolated app state, while durable `runs/<id>/result.json`
documents live in the user data scope and require `lia_fs_read_text` with `permanent: true`. The
product finalizer already writes the Result before its app-state index entry, so this is a test-only
scope error rather than missing scientific output. MHCflurry and pVACseq now share one data-scope
JSON reader, covered by a regression that rejects app-storage access. Promotion still did not run;
one bounded retry is allowed only after the focused test, `test:verify`, clean push and fresh runner
preflight pass. The focused regression now passes all 15 tests, and `test:verify` passes all 70 test
files and 485 tests, SDK regeneration, Core/frontend builds and bridge compilation.

Protected release `33267756734` at exact commit
`f75f744ade0171b1700c4304d105c4896ddbc7f3` completed successfully. The KMS-signed
MHCflurry `2.2.1-beta.1` `macos-aarch64-metal` box passed clean build, native self-test,
scientific CPU/Metal parity, immutable publication, candidate installation, cancellation, real
offline inference, Jobs, navigation-safe Results/provenance, experimental-disclaimer and removal
checks before beta promotion. Its reviewed evidence is retained at
`runtime-boxes/evidence/mhcflurry-class1-presentation-macos-aarch64-metal-2.2.1-beta.1-run-33267756734.json`.
Independent public readback verified both signatures, the release manifest SHA-256
`d576f64b4e82bee351220ba342b8d25399de9107482c8c9deee15ddf91136114`, and all
459,529,386 archive bytes with SHA-256
`511c3a86178fc5be92e2dc2647f17ecf4b7321bd5277b8266e9476aa79463053`.
The exact target is now `published` and MHCflurry is in the normal AI Model catalog; every other
MHCflurry target remains planned and hidden. The ephemeral runner exited successfully, removed its
credentials and work root, and the repository runner inventory returned to zero. At that checkpoint,
pVACseq publication and catalog activation were the only open Phase 2 release work. The catalog activation passed
`npm run test:verify` (70 files / 485 tests) and the real desktop UI gate (7 applicable suites passed,
2 intentionally skipped); an initial cache-lock denial was only the sandbox blocking Pixi's shared
package cache, and the required-access rerun passed without a product change.

The first protected pVACseq release attempt, run `33328650028` at exact commit
`fc30cfb5b357355b20c3b99cc527eb13df3cbc34`, built and KMS-signed the box but failed its independent
self-test before scientific validation, publication or promotion. The exact error was
`OSError: AF_UNIX path too long`: the workflow forced Python's temporary directory under the long
self-hosted runner root, and pVACtools' `pymp` dependency creates a local Unix socket there. macOS
verify and validator steps now use the short `/tmp` root; Linux and WSL retain the large runner temp
volume. A focused workflow regression covers both validation and release definitions. One bounded
retry is allowed after the fix passes `test:verify`, reaches clean remote `main` and passes fresh
runner preflight; any further failure requires a new diagnosis. The failed runner deregistered and
its marked root was removed, and repository runner inventory returned to zero. The focused catalog
suite passed 27 tests, catalog validation passed, and `test:verify` passed all 70 files / 486 tests,
SDK regeneration, Core/frontend builds and bridge compilation.

Retry `33329426470` at exact commit `0ba4cb7b86e44d5410736e5a3ebcc6f1c5d0e502` proved that
correction: signed self-test and the full scientific validator passed, followed by immutable
publication of the 994,583,879-byte archive
`f90a4894e7ed934cc1a7424e2b206350dbc7ce8fcc6e9484e46df8271fdad458` and signed release
`7608ff63f9ef5a6aa2df4ae1751779604274feb2e643e75c53e05fe3f3054209`. The real app then exposed a
separate product-only path limit: its generated `mhcflurry-predict` script placed the installed
runtime Python's 261-character path directly in the shebang, so macOS could not start it and
pVACtools' broad upstream exception reported an empty MHCflurry error. Promotion did not run and
public channel readback returned 404. The launcher is now a short `/bin/sh` wrapper that passes the
same exact runtime Python and guarded predictor as quoted arguments. A real regression invokes it
through a Python path longer than 255 characters and passes; `test:verify` passes 70 files / 487
tests plus every build and compile gate. The runner was removed and inventory again returned to
zero. At that point one fresh bounded retry was allowed after clean push and preflight; another
failure would have stopped the release for a new diagnosis.

Protected release `33330550558` at exact commit
`8509b0ce4bc67ee0a2ba2961bf6c6f7025f34b63` then completed pVACseq successfully. The KMS-signed
`7.1.2-beta.1` `macos-aarch64-cpu` box passed self-test, the official reduced scientific fixture,
immutable publication and the complete real-app lifecycle before beta promotion. The lifecycle
proved installation, cancellation, real offline inference, Jobs, navigation-safe Results and
provenance, the experimental disclaimer, removal, and survival of eight Result artifacts. Independent
public readback verified the signed channel and release, release SHA-256
`563fbd508ac1c2fc2975ca89ba95f3a4a969bfb663c37e16dcdcc2aa959ca8ef`, and all 994,583,880 archive
bytes with SHA-256 `e9dbac894d1acec99434fec05c3b39c1e5acce2f2fe0bc6856466173c9a609f5`.
The retained evidence is
`runtime-boxes/evidence/pvactools-pvacseq-macos-aarch64-cpu-7.1.2-beta.1-run-33330550558.json`.
The exact target is now published and active in the Tool Runtime catalog; the Neoantigen card,
pipeline step and preset are therefore visible in the normal app. The runner and marked work root
were removed and the repository runner inventory returned to zero.

Final catalog activation passed `npm run runtime-box:catalog:check`, the 92 focused contract tests,
and `npm run test:verify` with all 70 files / 487 tests plus SDK generation, Core/frontend builds,
zero-warning Svelte checking and bridge compilation. The real desktop gate then passed all seven
applicable suite groups, including 35/35 main scenarios and the direct visibility check for the
published MHCflurry card, Neoantigen card and tumor-to-neoantigen preset. Platform-specific suites for
other operating systems remained skipped as designed.

Activation commit `1dbd329b3da292d120c5883a44f552c977ac0308` reached `origin/main` cleanly. Its
catalog-only automatic checks passed for pVACseq in run `33332043809`, MHCflurry in run
`33332043821`, and the shared UCE catalog path in run `33332043824`; public SDK synchronization also
passed in run `33332043727`. These push checks did not request native or GPU work.

## Oncology Phase 2 is complete for the authorized scope (2026-08-30)

MHC-I Epitope Prediction and pVACseq Neoantigen Prioritization now have shared contracts, bounded
offline product scripts, direct and pipeline execution, Jobs/Results/provenance, cancellation and
navigation-safe finalization. The Runtime Box source includes exact locks, asset hashes, legal
inventories, CI workflows, scientific validators and lifecycle E2E specifications. MHCflurry has
prepared Apple Metal, Linux/Windows CPU and Linux/Windows CUDA targets; pVACseq has macOS/Linux CPU
targets, with Windows WSL2 recorded only as future evidence and not current product support.

Each direct screen now binds only to its own direct-run Job, so a pipeline execution cannot disable
or replace unrelated direct-run inputs. Persisted Results record every selected scientific parameter,
primary and optional proximal input inspection, accelerator and disabled-network state, plus the exact
signed Runtime Box version, target and archive SHA-256. The Neoantigen card and pipeline preset are
derived from the published Tool Runtime catalog rather than maintained as a separate availability flag.

MHCflurry `macos-aarch64-metal` is published and exposed in the active AI Model catalog. pVACseq
`macos-aarch64-cpu` is published and exposed in the active Tool Runtime catalog. Every other oncology
target remains `planned` with native CI disabled. No CUDA CI or unsupported target publication ran.
The unmodified upstream pVACtools wheel retains generic IEDB integration modules because pVACseq loads
that machinery even when it executes the local MHCflurry predictor. Liatir exposes only
MHCflurry/MHCflurryEL, sets IEDB retries to zero and denies network access to the parent and child
processes; deleting those upstream modules would require an unsupported pVACtools fork.

The previously missing source-mirror boundary is deployed and proven. Commit `8128002` added a manual
`runtime-box-production` workflow plus a Registry route that derives the only accepted R2 key, size,
SHA-256 and content type from the fixed ID `mhcflurry-class1-presentation`. Wrangler deployed clean
commit bytes as Registry version `f8905c7a-9893-4d52-93dd-bbcbf4926a34`; public health passed, the
`ADMIN_TOKEN` secret and `liatir-storage` binding remained attached, and an unauthenticated create was
rejected with 401. The billing-blocked run `33064748592` never created a job. The first healthy run
`33159915001` reproduced the archive but failed before contacting the Registry because the stable CLI
did not route the new command. Commit `1a891c7` fixed that exact boundary and added a regression test.
Run `33160339119` then passed the allowlist, official-source hash, deterministic repack, restricted
multipart upload, public byte/hash readback and receipt upload. An independent public download matched
135,602,727 bytes and SHA-256
`44784a00d480298b66bfc232e2d1bb1a2df5e564f894a2fcc15d29fbd83f0d1e`, with 45 archive entries limited
to `models` and `LIATIR_SOURCE.json`. Receipt artifact `9681436581` has digest
`sha256:2047147d0330adb7154edd4309e014b1fc50cde2fc11f050b52703c15cee34c9`.

Local evidence: the final `npm run test:verify` passed 70 files / 473 tests; Rust passed
91 tests with 2 heavy fixtures ignored and Clippy had no errors. The desktop UI gate passed its 34
native scenarios and all applicable companion suites; the two new heavy component specifications
loaded but skipped because their boxes are unpublished. Catalog, JSON, JavaScript syntax and diff
checks passed. The exact acceptance ledger and remaining publication sequence are in
[New scientific model integration](./roadmap/new-ai-models-integration-plan.md).

Commit `e7a7a7b16bbfb37f322db13bda55c6f91ed55e2b` is now on `origin/main`. Its automatic GitHub
preflights passed for MHCflurry in run `33161230745` (artifact `9681714960`, digest
`sha256:7984adb083f2d1eaadc54faffb3c4a21fc98bae2fbe04412260494c24aaf0fd6`) and pVACtools in run
`33161230937` (artifact `9681718976`, digest
`sha256:6cceb615655ac04546538578d0bac44dd30b458be679329ce00ac258a45bed84`). Both receipts identify the
clean pushed commit and passed the legal, recipe, target, runner, timeout and catalog contracts. The
native jobs were skipped by design because every new target still has `nativeCiEnabled: false`.
The same push ran the existing public SDK mirror successfully as run `33161230603`, producing
`liatir/sdk` commit `902661f41b478a4938e050158714ebc432945b97`.

After disk was freed, commit `d8bc51266e8e1eff779c25f0d366d75479de98dc` enabled only MHCflurry
`macos-aarch64-metal`; a regression guard keeps the other six oncology targets disabled. Manual run
`33166465046` passed on exact ephemeral runner `liatir-macos-heavy-1787915736-91228`: clean pixi
build, development signature verification, archive/layout self-test, scientific CPU/Metal comparison
and 23 Rust Runtime Box lifecycle tests (2 heavy fixtures ignored). The 459,529,381-byte archive had
SHA-256 `b9d645b4051eb796308ba29b66005891658c4258e26b32296de57b04bb36b72e` and installed size
1,379,850,808 bytes. MHCflurry 2.2.1 with torch 2.8.0 produced finite binding and presentation
predictions; repeated CPU ranking and Metal parity passed at absolute/relative tolerance 0.001, with
maximum absolute difference 0.0014372563091455959. Compact evidence artifact `9683966329` has digest
`sha256:3c7a180df1d584ba4f8b188bc11877d5d020b40b982dbd6df2fc26cdb1531e54`. Cleanup passed, the runner
deregistered, its marked root was removed and the repository runner inventory returned to zero.

The pVACseq correction is on `origin/main` as clean commit
`ac44d6a70dafff60b144fec6fedaa9a80fc360db`. It prevents Python multiprocessing children from
re-entering the stdin runner, permits only local Unix-domain sockets for process coordination,
retains the anchor/report resources pVACseq actually needs, and uses the reviewed 0.001
absolute/relative score tolerance. A fresh local box passed self-test and the official reduced
pVACseq fixture; the final `npm run test:verify` passed 70 files / 479 tests. Rust passed 92 tests
with 2 heavy fixtures ignored and Clippy completed without errors. Automatic preflight run
`33226907559` passed; artifact `9707173508` has digest
`sha256:277af6af86c03f6056ce92a4797ebef0ccc39a57dce5c8e94377fa1e434fbd02`.

Manual native-lifecycle run `33227035747` passed on ephemeral runner
`liatir-macos-heavy-1787967600-24204`: clean build, development signature/archive/layout/self-test,
official-fixture scientific parity and 23 Rust Runtime Box lifecycle tests (2 heavy fixtures
ignored). The 994,583,880-byte archive had SHA-256
`1d36f172182ed940ad413a19791defca527e6866a803208aef231eee04c9b706` and installed size
3,598,150,920 bytes. The scientific run produced 540 all-epitope rows, 3 filtered rows and 11
aggregates, compared 2,160 finite scores and stayed within 0.001 absolute/relative tolerance;
maximum absolute difference was 0.007866887946875067. Compact evidence artifact `9707342686` has
digest `sha256:56925fdfad59a98fffa48ea3e7cee3f36657cac370de43286f42b99ae095c7b9`.
Cleanup passed, the runner deregistered, its marked root was removed and repository runner inventory
returned to zero.

The public MHC source mirror was independently read again on 2026-08-29: HTTP 200,
135,602,727 bytes and SHA-256
`44784a00d480298b66bfc232e2d1bb1a2df5e564f894a2fcc15d29fbd83f0d1e`. Phase 2 is complete for the
authorized implementation and first-native-target scope. This is not a publication claim: both
components remain absent from active catalogs until separately authorized protected signing,
immutable publication and packaged-product lifecycle evidence exist. The final catalog/status commit
`028105fa9fc8c279ad5597801b35923eb9862a33` passed automatic preflight run `33227635616`; artifact
`9707405477` has digest
`sha256:6511f0cdb29247f2d13f4465d23a189873d5aaed1e9e6151d3f0eba3d3a2d1ba`.

## Runtime Components and scientific contracts are ready for model-specific phases (2026-08-25)

Runtime Boxes now have one signed lifecycle for two honest product kinds: AI Models and Tool
Runtimes. Existing AI environments and commands remain compatible under `ai-runtimes`; scientific
command environments are isolated under `tool-runtimes`. Dependencies provides install, explicit
manifest-only update check, user-triggered Update, cancel, rollback and remove. Nothing checks for
or downloads an update automatically.

Core now owns the six new versioned scientific input/output profiles, `LiatirComplexSpec v1`,
multi-model AI provenance while retaining the primary model fields read by existing Results, and a
lazy memory-bounded DCD Result player. The CI catalog is schema v2 and component-aware without changing Scrollcase v2 identity,
signatures, target IDs, trust, revocations or anti-replay. The Tool Runtime catalog intentionally
has no entries until the pVACtools and OpenMM phases produce their own release evidence.

Evidence: `npm run test:fast` passed 454 tests; `npm run test:verify` passed all six suites; Rust
passed 91 tests with 2 ignored and Clippy completed without errors. `npm run test:ui` passed all
seven applicable desktop suites, including 34 native app scenarios plus a
real signed Tool Runtime install/update/rollback/remove lifecycle beside a still-runnable legacy AI
alias, anti-replay across restart, Dependencies, and the macOS install lifecycle. Windows and Linux
desktop lifecycle evidence remains platform-specific and was not claimed from macOS. No heavy AI,
GPU CI, publication, application signing or deployment ran. Full decisions and scope are in
[New scientific model integration](./roadmap/new-ai-models-integration-plan.md).

Release follow-up: the clean frontend install reported five advisories across production and
development dependencies (two low, one moderate and two high). The production-only `npm audit`
could not be queried because this environment did not permit sending the dependency inventory to
the external npm advisory endpoint, so the affected dependency scope still needs an authorized
registry audit before a public package release.

## SnpEff and SnpSift are one verified, on-demand suite (2026-08-25)

The manual SnpEff download path is gone from the normal product flow. Liatir now presents one
pinned SnpEff and SnpSift release, downloads both applications together, checks the exact archive
and installed components, activates them atomically and reuses the verified local copy. Java 21+
remains the only host dependency and the suite stays separate from the Native Tools Scrollcase box.

SnpEff genome databases now come from the same built-in catalog. The user chooses an explicit
species, genome assembly and Ensembl release; Liatir downloads and verifies it once, records its
identity with each run, and can remove it later. Human GRCh38, mouse GRCm39, zebrafish GRCz11,
fruit fly BDGP6, *C. elegans* WBcel235 and yeast R64-1-1 are pinned to Ensembl 115 and the compatible
SnpEff 5.4c database series. External installations remain an advanced, visibly unverified option
and Liatir never deletes their files.

SnpSift Filter is available as both a direct Tool and a pipeline step. It streams VCF output to
disk, offers readable high-impact, high-or-moderate, missense, stop-gained and minimum-quality
presets, and keeps an advanced expression mode. Runs record the resolved expression and exact suite
evidence; presets that depend on SnpEff's `ANN` annotation say so before execution.

Evidence: `npm run test:verify` passed all 6 suites, including 65 unit files / 435 tests and a clean
Svelte check. Rust passed 87 tests and Clippy. `npm run test:ui` passed all 7 applicable suites; its
isolated SnpEff/SnpSift lifecycle proved one download, verified reuse without another request, and
complete managed removal. The durable contract and exact validation ledger are in
[Managed SnpEff and SnpSift suite](./roadmap/snpeff-snpsift-managed-suite.md).

## API Connector now has a Liatir-native contract (2026-08-25)

The Bubble-derived surface has been removed. Calls no longer carry a meaningless
Data/Action mode, and parameters now say exactly what Liatir does: enabled,
exposed as a run input and required. There is no destination selector:
URL/header `[parameters]` and body `<parameters>` are discovered automatically,
while manually added fields always belong to the body. The UI lists URL/header
parameters next to those fields. GET and HEAD have no Body section. JSON keeps
manual body fields, its JSON editor and discovered JSON parameters separate;
Form fields has only key/value rows, and Raw has only its text editor plus any
discovered placeholders. Existing workspaces migrate once without losing executable
configuration; copied fields and the unimplemented OAuth User-Agent mode are
removed from the rewritten file.

`Test request and detect outputs` is now a true preview: it performs the request,
shows the response and refreshes the structured output schema without creating a
Job or Result. `Run` remains the durable execution path. Nested JSON fields keep
real paths and primitive types in direct, pipeline and MCP use; required values,
invalid JSON, HTTP errors and changed response types fail visibly.

External HTTP moved from the webview to the cancellable native bridge, removing
browser CORS as a product limitation. The bridge accepts only HTTP(S), rejects
embedded URL credentials, bounds redirects/time/response size and can cancel
both connection and response reads. JSON, raw text and URL-encoded form are the
body modes actually sent.

Evidence: `npm run test:verify` passed 65 files / 437 tests and all six build and
type suites. `npm run test:ui` passed all seven applicable suites: native Tauri E2E
was 34/0/25, including placeholder synchronization, separated parameter lists,
API preview, direct and pipeline success/failure/cancel;
the reference-index, restart, Runtime Box security and macOS install lifecycles
also passed. Windows and Linux install lifecycles were skipped on macOS. The
durable contract is in [API Connector](../truth/architecture/api-connector.md).

## The knowledge base became `.mind`, and it is the only memory (2026-08-24)

`project-knowledge-base` is now `.mind`. The rename is not cosmetic: it settles
what this folder is. It had been framed as "private maintainer documentation"
while in practice it was also the project's memory across sessions — and an agent
had been keeping a second, host-local memory store outside the repository, so the
two drifted and neither was complete.

**One memory, shared.** A project's knowledge serves everyone who works on it.
Agents are not tools that consume documentation; they work on this repository the
way a developer does, and they write to `.mind` as much as they read it. So there
is no human copy and no agent copy — there is `.mind`, and the copy throughout no
longer addresses only a human reader.

**Nothing durable may live outside the repository.** The host-local memory store
was deleted. The two facts it held that were not written down anywhere else — the
per-model CPU support gating principle, and that Scrollcase's maintainer is
Liatir's maintainer — are now in the standing constraints below. `AGENTS.md` states
the rule directly under "Memory lives in this repository, and nowhere else".

**`.mind/.agents`** holds the working agreements that apply only to agents;
`AGENTS.md` at the repository root is the entry point that links to them. They sit
inside `.mind` because they are project knowledge too, addressed to one kind of
colleague — and the leading dot is deliberate: they are operating rules to be read
where they are used, not pages of a rendered site. VitePress skips dot-directories,
which is the wanted behaviour here.

Five `runtime-boxes/scrolls/**/pixi.toml` files still name the old path in a
comment. They are deliberately untouched: a scroll's bytes determine its
`sourceRevision`, so editing a comment would invalidate boxes that are already
built and signed. A stale path in a comment is cheaper than a re-signing round.

## Every run records what it actually did (2026-08-23)

A user must be able to open any run and read what happened: the whole transcript,
and every file it left on disk. That was already the design — `LiatirFileArtifactRole`
has carried `intermediate` since artifacts were introduced — and it was implemented
in exactly one tool, the Single-cell Embedding AI Tool. Everywhere else a run
recorded only its declared outputs and a display copy of its log.

Checking tool by tool mattered here, because the first read of the code overstated
the problem. Four of the six native tools genuinely leave nothing behind: `minimap2`
writes its one SAM, and `samtools flagstat`, `bcftools stats` and `seqkit stats`
report on stdout. Their hardcoded `final` role was correct, not lazy. The evidence
was being dropped in a smaller number of specific places:

- **fastp** wrote its JSON report, read the numbers back out of it, and never listed
  it — and sent its HTML report, the readable per-base quality view a biologist
  actually looks at, to `/dev/null`.
- **bwa** indexes an unindexed reference before aligning, dropping five files beside
  the user's own FASTA, under their filename, with nothing in Liatir saying so.
- **samtools faidx** writes a second index (`.gzi`) for bgzip-compressed input.
- **SnpEff** listed its summary and gene stats as though they were results.
- **External Workflows** wrote Nextflow's log, trace, execution report, timeline and
  DAG — the first things anyone reads when a workflow misbehaves — and mentioned none.

Two things about logs were worse than the files. Every process line already flowed
into the execution spine through `runNativeTool`, was persisted on every line, and
was **never shown anywhere**: Liatir paid the full cost of capturing stdout and
stderr and then discarded it, because `finalizeExecutionResult` preferred the
caller's own array (`result.log ?? execution.logs`) and every tool page passes one.
Those arrays are display transcripts — filtered, capped at a few hundred lines. And
`analysisRuns` deleted log files after seven days while keeping the runs, so an
older Result opened mute, which is backwards: old runs are the ones someone is now
trying to explain.

The rule now lives in `finalizeExecutionResult`, the single place a Result is
committed, so it is enforced rather than repeated in thirteen pages:

- the transcript comes from the execution spine, always, with `stderr` marked so the
  distinction survives flattening; `runNativeTool` records the command as spawned,
  so no caller has to narrate itself;
- `sideEffects` is **required and has no default** — `[]` is a real answer, but one
  someone has to give on purpose. An optional field is the one every new tool
  forgets. Making it mandatory broke thirteen call sites at compile time, which is
  the enforcement working;
- by-products are filed with an honest role (`bwa`'s index is `cache`, not
  `intermediate` — later runs reuse it, which is why this one skips indexing when it
  exists) and the results view shows them apart from the result, so a run that
  produced one alignment and six index files does not read as seven results;
- a run's transcript now lives as long as the run, with both files deleted when a run
  is evicted past `MAX_RUNS` — unbounded age, still bounded disk.

Pinned by `tests/unit/run-recording-rule.test.ts`.

### An empty declaration is now checked, not believed (2026-08-23)

The gap left open above is closed for standalone tool runs. Tools used to write into
one shared `tool-outputs` folder under run-prefixed filenames — which keeps runs
apart but leaves nothing to enumerate, since you cannot tell by looking at the folder
what this run put there. Each run now gets `tool-outputs/<runId>`, and
`finalizeExecutionResult` lists it: anything present and undeclared is recorded
anyway, under its own filename. A tool that writes a file and forgets to mention it
no longer hides it. `ensureToolOutputsDir` is deleted rather than left as a second
way of doing the same thing.

Matching is by filename, not path: declared paths are built with forward slashes
while `lia_fs_list_dir` returns the platform's separators, and comparing those
directly would report every declared file as undeclared on Windows.

`sideEffects` stays required, with a narrower and clearer job — files written
*outside* the run directory, which enumeration cannot see. Some tools have no
choice: `bwa`'s index has to sit beside the reference for `bwa` to find it. That is
also why `[]` still has to be said rather than defaulted.

### One layout for every run (2026-08-23)

The boundary above is gone, and the objection behind it was weak: the Data library
indexes absolute paths under a virtual folder label, so where a file physically lives
was never what the user browses. Pipeline steps could always have had their own
directories without moving anything the user sees.

Every run now owns `runs/<runId>` — a tool, an AI Model, a plugin, an API call, an
External Workflow, a pipeline, and every step inside one:

```text
runs/<runId>/
  metadata.json   what this run was          (LiatirRunMetadata)
  result.json     the parsed output Liatir renders
  log.jsonl       the transcript, one entry per line
  steps.json      pipelines only             (LiatirRunSteps)
  output/         the files the run produced
```

**Flat, not nested.** A pipeline's steps are ordinary runs in `runs` beside it,
listed in its `steps.json`. Nesting would make the same code handle two shapes and
would recurse without bound through sub-pipelines. `steps.json` is separate from
`metadata.json` because one describes the run and the other describes what happened
inside it.

**`steps.json` is `{ schemaVersion, steps, connections }`, not a bare array.** It was
first written in graph-array order — the order nodes were dropped on the canvas —
which reads as a sequence that was never run. Steps are now ordered by `startedAt`,
with nodes that never started last, in graph order. There is deliberately **no index
field**: a pipeline is a graph, independent steps can start in the same millisecond,
and numbering them would assert a sequence that does not exist. Sorting by a real
timestamp says what is true without inventing what is not.

`connections` carries the edges — `{ from, output, to, input }`, named by handle on
both ends — because execution order does not say what feeds what: two adjacent steps
may be unrelated, and one may depend on a step that finished long before. The handle
is what makes a condition legible, since its outputs are `trueBranch` and
`falseBranch`; the branch actually taken is on the condition step as `activeBranch`,
so it need not be inferred from which output value came out empty. Both branches stay
in `connections` — which one was abandoned is readable from `activeBranch`, and
dropping it would hide half of what the pipeline is wired to do. Edges are recorded
once, never denormalised onto both endpoints, and never pointed at a nodeId the file
does not list.

`pipelineStepsRecord` moved out of the store into `frontend/src/lib/execution/pipeline-steps.ts`.
It is a pure function of (nodes, edges, states), and order and wiring are exactly the
things that look right until someone reads the file — so they are unit-tested in
`tests/unit/pipeline-steps-record.test.ts` rather than only observed after a real run.

**Utility nodes get an identity but no directory.** A `variable`, `math` or
`condition` node computes a value rather than running a process; a folder per
arithmetic operation would be machinery heavier than the problem. Its result is
recorded in `steps.json`, and enumerating a directory that was never created
correctly reports nothing — the same code path, no special case.

`log.jsonl` rather than an array inside `metadata.json`: a transcript is appended to
while a run is in progress, and a format that must be reparsed and rewritten whole is
what made logging cost more the longer a run went on.

Three things this settled along the way:

- **Results means results.** `role` has always distinguished them; nothing read it.
  Pipeline steps stamped `final` on everything and registered all of it, while
  standalone tools escaped only because each page hand-picked one path. Registration
  now happens once, at finalization, filtered to `final`. By-products are reached
  from the run: the results panel shows a count, and the run itself offers the folder.
- **Nothing is deleted automatically.** `MAX_RUNS` is gone: a run now owns files the
  user made, and a list growing long is not a reason to destroy them. Pruning is an
  explicit action that says what it will delete, including how many of the files the
  Data library still points at, and clears those entries so the library is not left
  full of dangling paths. Deletions go to Liatir's trash, so the action does not
  promise disk space back.

The legacy layouts are deleted outright rather than migrated — Liatir is unreleased.
`ensureResultsDir`, the physical `Results/<Tool>` folder and the flat `tool-outputs`
are gone; the **virtual** `Results/<Tool>` in the Data library stays, because that is
the user's organisation, not a storage detail.

**Run directories are workspace-scoped**, like the index that points into them, so
deleting a workspace reclaims what its runs produced. They live in the **data** root,
not app storage — app storage is a subdirectory of it reserved for Liatir's own state.
Getting that wrong is what four E2E failures caught: the history index is app-scope
and the runs it indexes are not, and MCP was still reading both from app storage.
`startup_cleanup` also had to learn to skip `output`, since a JSON it cannot parse
there is the user's data, not corruption to tidy.

What still stands apart: the interrupted-pipeline recovery path in
`pipeline.svelte.ts` calls `analysisRuns.add` directly, because it reconciles from a
serialized runtime snapshot with no execution record to draw a transcript from. It
now writes its own `log.jsonl` so a recovered run is not mute.

#### Opening a run folder needs a command of its own

`shell.open` cannot reveal a directory. The shell plugin validates its argument
against a URL regex (`mailto:`/`tel:`/`http://`/`https://` unless
`plugins > shell > open` is configured otherwise), so a filesystem path is rejected
inside the plugin and never reaches the platform. `shell:allow-open` being granted is
irrelevant — the capability lets the webview *call* the command; the regex is what
decides its argument. The first version of the button went through `openPath` on the
bridge and therefore did nothing at all, silently, since the rejected promise had no
handler.

Widening that regex to accept paths would admit any path on the machine, an
executable included, because the plugin has no notion of which directories are
Liatir's. The constraint that actually holds is "inside the data root", which
`lia_fs_safe_join_data` already enforces — so revealing is `lia_fs_reveal`, a command
of our own that safe-joins a **relative** path and refuses anything that is not a
directory. No absolute path crosses the bridge. `openPath` is gone; `openBrowser`
stays on `shell.open`, where a URL is what the regex is for.

**Registering a bridge command is not granting it.** `permissions/liatir-bridge.toml`
is an explicit allowlist; a command in `generate_handler!` that is missing from it
compiles, passes `cargo check`, and is refused at runtime with
`"<cmd> not allowed. Command not found"`. The Quenta-scoped guard for this has been
generalised in `tests/unit/quenta-tauri-permissions.test.ts` to check *every*
registered `lia_*` command, so the class fails in `test:verify` instead of costing an
E2E build. It immediately found three standing gaps: `lia_quenta_docs_sync` was
registered and invoked but never granted, and `knowledge-sync.ts` swallows the
rejection as "offline" — so Quenta's online corpus sync had never once run. The three
`lia_logs_test_*` diagnostics helpers were ungranted the same way. All four are now
listed.

**The affordance belongs to the run, not to its results.** It started inside
`ToolResultView`, gated on there being by-products — so it was missing from the
Results screen entirely, from every failed run, and from any run with no structured
output: exactly the runs someone opens a folder to understand. It now lives in
`RunRecord.svelte` (formerly `RunLog.svelte`, renamed because it is no longer only
the log), beside **View log**, on every screen that shows a run and in the failure
branch of each. The result view keeps the by-product *count*, which is about the
files. A run that wrote nothing has no directory, and the button says so rather than
appearing to do nothing.

It is the one bordered control in that row. Small is right — it is not the point of
the screen — but as plain 11px text beside **View log** it read as a footnote and went
unnoticed; the border is what makes it look like something you press.

**On the Results screen it sits with the run's other actions instead** (2026-09-11).
That screen is the one place a run already has a header of its own, and having
**Explain** and **Export HTML** at the top with the folder alone further down split
the same run's actions across two places. It now joins them there, so `RunRecord`
takes `showOpenFolder={false}` on that screen only — the flag exists to prevent the
duplicate, never to drop the affordance, and `run-recording-rule.test.ts` fails any
screen that sets it without revealing the folder itself. The three actions are one
`runActions` snippet rendered either as a row or, under `ACTIONS_INLINE_MIN_WIDTH`
(560px measured on the header row, not the window — the run list beside it takes
width too), stacked in an **Actions** menu. `revealFailureMessage` in `run-storage.ts`
is the shared wording for a folder that did not open; the header raises it as a toast,
because the menu it was clicked from is closed by then.

## Native Tools are one signed Scrollcase box (2026-08-22)

The six process-backed tools — `samtools`, `bcftools`, `seqkit`, `fastp`, `bwa`
and `minimap2` — now ship in one **real Scrollcase v2 box**. The authoring source
is `runtime-boxes/scrolls/native-tools/`, with separate locked targets for
`macos-aarch64-cpu` and `linux-x86_64-cpu`; Windows uses that Linux target inside
WSL2. FastQC remains in-process WASM and SnpEff remains the one Java-based tool.

There is no second box format. `scrollcase@0.8.0` builds, self-tests, signs and
verifies the resource. `scrollcase-consumer 0.3.2` verifies the compiled-in trust
anchor, signed release, archive, box manifest and payload digest before the Rust
bridge exposes a binary. Windows runs the same consumer semantics through a
static Linux helper whose digest is compiled into the Windows executable, so the
user installs no Node, Python, pixi, conda or archive tool. The previous
`native-tools-env`, tar sidecar, completion marker and custom shell extraction
path are removed. Signed provenance binds the release to the current metadata,
self-test and per-target dependency lock, so packaging refuses a valid but stale
box as well as an invalid one.

The macOS target was rebuilt from the new scroll by the current `test:ui` gate
and passed all six real self-tests, signature/archive verification and the
packaging `require` gate. The compiled Tauri app then proved that a bare SeqKit
request ran version 2.13.0 from the embedded box rather than `PATH`; the main
native suite is 33 passed / 0 failed / 23 skipped, with restart, Runtime Box
security and desktop lifecycle phases also green. `test:verify` is 57 files /
340 tests, Rust is 79 passed / 2 deliberately ignored, and Clippy exits 0. The
Linux/WSL target is authored, locked and covered by the same CI workflow but has
not yet been rebuilt and re-executed after this format migration; the Windows
and Linux evidence below predates the migration and must not be presented as
current Scrollcase-box evidence.

## Platform coverage for the Native Tools is closed (2026-08-22)

Three maintainer decisions, and together they mean **every platform Liatir
supports now has a Native Tools box target**.

**SnpEff stays out**, and Java stays the one dependency Liatir manages rather
than ships. Bundling SnpEff means bundling a JRE that would outweigh all six
tools combined, for a tool most users never open, and its databases already live
outside the application. Java is now the only entry on the Dependencies screen a
user of a supported platform can still be asked to install for a Native Tool.

**macOS x86_64 is not a target, ever.** Not "no environment yet" — Intel Macs are
out of the product, and Apple silicon with Metal is the only macOS Liatir
supports.

**Linux ARM64 gets no environment**, for want of an application rather than of
tools: all six resolve on `linux-aarch64` at identical versions in 41 packages,
checked 2026-08-22, but Liatir ships macOS arm64, Windows x86_64 and Linux
x86_64, and building an environment for a fourth would be building it for an
application that does not exist.

The consequence, acted on the same day: `binary-releases.ts` and the managed-bin
installer were waiting on exactly those two platforms, where they were still the
only route. Nothing Liatir supports depended on them any more, so they are gone —
the registry, `binary-manager.ts`, the `managedBins` store, four bridge commands
and the extraction chain only they reached, the Dependencies-screen install,
update and remove buttons, and the managed-bin lookup inside `resolve_spawn`. A
leftover entry from an older release could only ever have been preferred over the
build this release shipped, which is the drift the bundle exists to remove.

The native downloader stays: viewer runtimes, SnpEff databases, Runtime Boxes and
the generic download store all go through it, and its resume-and-cancel contract
is now pinned where it is implemented instead of across a deleted installer. What
STAR, hisat2 and bedtools left `dep-requirements.ts` the same day. The
Dependencies screen was asking users to install three programs no code in the
application could run. Whether to bundle them instead was asked and answered no:
STAR wants ~30 GB of RAM to index a human genome, hisat2 pulls a Python
interpreter into a bundle that has none, and two aligners do not make an RNA-seq
path — counting and differential expression come after, the latter in R. The full
reasoning, including why alevin-fry is the interesting one if this is ever taken
up, is in the roadmap doc.

CI builds and signs the Scrollcase targets on `ubuntu-24.04` and `macos-15`
(`.github/workflows/native-tools-box.yml`), manually or when a scroll, lock,
self-test, legal audit, consumer or build input changes. There is no Windows
build job: the complete `linux-x86_64-cpu` artifact, including its static WSL2
Scrollcase consumer, is the Windows input.

Java is now the only dependency Liatir asks a user to install, which made it worth
checking that Liatir can tell whether the right one is there. Two of the three
answers were reassuring — the version bounds already reject a JDK that is too old,
and no rival program answers to the name `java`, so `wrongToolPatterns` stays
empty for it. The third was a real defect: macOS ships a stub at `/usr/bin/java`
that exists with no JVM behind it, and a machine with no Java at all was reported
as fine, with SnpEff failing later and nothing connecting the two. `java` now
declares `versionMustBeDetectable`, the two UI surfaces share one verdict through
`depVersionSatisfied`, and the wrong-tool resolver explains why Liatir says "not
installed" about a command the user can see. Details and the reasoning are in the
roadmap doc.

## Historical pre-Scrollcase Native Tools implementation (superseded 2026-08-22)

The remainder of this section records the implementation and evidence that
preceded the Scrollcase migration. Its tar format, custom extraction path, sizes
and platform runs are historical evidence only; the current contract is the
signed Scrollcase box described above.

Liatir distributed executable dependencies three ways — signed Runtime Boxes for
AI Models, pinned upstream binaries in `binary-releases.ts`, and "install it
yourself with a package manager" for everything those could not cover, which was
most tool and platform combinations. The third is not a distribution mechanism;
it is the absence of one, and it ended with an unverified binary on the `PATH`
that the resolver executed.

Six tools — `samtools`, `bcftools`, `seqkit`, `fastp`, `bwa`, `minimap2` — now
ship as one relocatable conda environment inside the application, built from a
committed `native-tools-env/pixi.toml` and `pixi.lock`. Not a Runtime Box: no
catalog, no download, no per-tool signature and no revocation, because those
exist for models that arrive *after* installation from outside, while a tool
inside the signed application is covered by the application's own signature.
Scrollcase is untouched.

**macOS arm64 is done and verified.** A 68.0 MB archive holding a 202.7 MB
environment, built in 9 seconds, with every tool run on real demo data both from
the build directory and from a prefix extracted somewhere else — `bwa mem` and
`minimap2 -ax sr` each produced 60 alignment records, `samtools faidx` indexed
four contigs, `seqkit stats` counted 60 reads over 4,500 bp. `resolve_spawn` in
`bridge/jobs.rs` prefers the bundle over managed binaries and `PATH`, and
`lia_deps_check` answers for a bundled tool from the build manifest, so the
Dependencies screen shows *Included with Liatir* instead of "Not installed" for a
tool that works.

It ships as an archive rather than as bundled resource files because the first
implementation measured 438 MB inside the `.app` for a 203 MB environment: the
Tauri bundler resolves symlinks into full copies and a conda prefix has 1,140 of
them, so `libopenblas` was written seven times. Unpacking 212 MB with `tar` takes
1.0 second, happens off the startup path, and is keyed by the lock digest. The
rebuilt package is a 111 MB `.app` and an 87 MB DMG, and the Gate 7 macOS
package gate passes with it — `codesign --verify --deep --strict` included.

**Windows is done too, and was executed rather than reasoned about.** bioconda
publishes no `win-64` builds at all, and five of the six tools have no Windows
build anywhere, so Windows ships the `linux-64` environment as one tarball and
runs it through WSL2 — the road Gate 6 already built for Nextflow. WSL2 unpacks
it into the Linux filesystem on first use, keyed by lock digest, because a conda
prefix is 1,200+ symlinks with execute bits that do not survive NTFS and would
pay the 9p cost on every library load from `/mnt/c`. The WSL2 crossing moved to
`helpers/wsl.rs` and is now shared rather than duplicated.

On Windows 11 x86_64 with WSL2/Ubuntu the archive was built inside WSL and every
gate ran green: `test:ui` 5 passed / 0 failed / 2 platform-skipped with
end-to-end 33 passed / 0 failed / 23 skipped, identical to the macOS baseline,
plus both Gate 7 Windows gates (a 109.4 MB unsigned NSIS installer that installs
and uninstalls itself). The three questions only Windows could answer are
answered: the first-run unpack lands 290 MB with all 1,162 symlinks in 1.9
seconds, a second launch does not redo it, and an interrupted one leaves only a
marker-less `.partial` that the next launch discards; killing `wsl.exe` removes
the Linux-side tool within a second, so no cancel token is needed as it was for
Nextflow; and a path containing a space survives translation intact, which is now
asserted by the bundled-tool E2E rather than trusted.

**Running the gate found four defects, three of them silent, and all are fixed.**

`native-tools-env/pixi.lock` was not byte-pinned in `.gitattributes`, so a
Windows checkout turned it to CRLF. That broke the build outright *and* changed
the digest that named the unpacked environment, so a Windows-built archive would
have disagreed with the Linux and macOS one built from the same lock.

The `linux-64` solve shipped a cross-compilation sysroot that nothing links
against — 239 MB, of which 215 MB was one locale template, and `ldd` finds zero
libraries from it in any of the six tools. Pruning it took the archive from
152.0 MB to 93.2 MB and the installer from 141.1 MB to 109.4 MB. Because that
same archive ships natively on Linux, it was re-verified there too, inside WSL2:
no missing library, and all six doing real work from a prefix they were not built
in.

A network path (`\\server\share\…`) was forwarded to the tool rather than
refused, so the user got the tool's raw `stat: no such file or directory`. Liatir
now refuses it before starting WSL2 and says to copy the file to a local drive.

And the unpacked environment was named after the **lock** digest rather than the
**archive** digest. The lock pins tool versions; the archive is the bytes they
were packed into. Change what the build packs and the archive moves while the
lock does not — so an older release's completion marker stays in place and the
app keeps running the environment that release unpacked. The sysroot pruning is
exactly that case and reproduced it. It is now keyed on `archiveSha256`, and
fixing it exposed a second gap: the Windows unpack had no equivalent of
`prune_other_digests`, so every superseded environment stayed in the Linux home
for good.

Every one of the four has regression coverage.

`bwa-mem2` was removed the same day: it was advertised for managed install under
its own name while every caller asked for `bwa`, so it could never resolve. A
contract test now requires every advertised binary to be one the dependency
catalogue declares.

The resolver order found a second latent defect. Three pipeline-lifecycle E2E
tests registered fake tools in `managed-bins/index.json` — `/bin/echo` for
seqkit, `sleep 30` for fastp — pointed at files in `/tmp` that nothing in the
repository ever created, so they passed only while somebody's `/tmp` happened to
hold them. Preferring the bundle made the fakes unreachable and the real tools
refused the missing files. The order stayed: a managed binary for a bundled tool
can only be a leftover from an older release. The suite now writes its own
inputs, including one sized so single-threaded fastp is genuinely still running
when the cancellation test asks — cancelling a real process rather than a
`sleep`. On Windows those three tests now need WSL2 and the linux-64 archive.

Full detail, measurements and the remaining package/release questions are in
[Native Tools as one Scrollcase box](./roadmap/native-tools-bundled-environment.md).

## Gate 8 controlled local MCP is cross-platform complete (2026-08-22)

Liatir now has an optional local MCP boundary around the saved-pipeline runtime.
It is off by default, binds Streamable HTTP only to an ephemeral IPv4 loopback
port, and uses its own 64-hex bearer token and dispatcher rather than the broad
`.lia` Plugin IPC path. Native MCP administration also checks the injected
Tauri window identity, so only the `main` window can enable the server, reveal
or rotate the token, change grants, resolve authorization or inspect the private
control records.

The surface is closed: `start_saved_pipeline({ pipeline_id, inputs })`,
`cancel_pipeline_run({ run_id })` and `cancel_job({ job_id })` are the only
tools. The revision grant freezes a recursively derived contract for every
client-settable input of Native Tools; AI Tools, including their currently
installed and compatible AI Model choices; `.lia` Plugins; saved External
Workflows; scientific viewers and utility steps; enabled API Connector
parameters exposed as run inputs; Variable, Math and Condition nodes; and nested
sub-pipelines. Connected values, graph topology, operations, fixed Connector
parameters and `@pipe:` references cannot be supplied. File inputs use allowed
workspace artifact IDs, never caller paths. MCP cannot install/manage AI Models
or define/edit External Workflows.

Read-only resources expose the active workspace, valid grant/input metadata,
MCP-owned run status/log/Result, MCP-owned Jobs, optionally all Results in the
active workspace, and registered artifact metadata/content. Result outputs from
MCP runs are automatically readable; workspace-wide Results and individual
source files from Data are separate explicit permissions in Settings. File
content is limited to 64 KiB chunks, symlinks/non-files are rejected, and
public metadata, Result output and Job views omit physical paths and raw command
arguments. The server still exposes no arbitrary filesystem browser, shell,
generic invocation, pipeline mutation, prompts or model-chosen scientific
decisions. Client name/version is audit metadata, never authority.

Every pipeline grant is tied to workspace, pipeline and exact saved revision.
An edit makes it stale. A start request is revalidated, receives its durable UUID
before authorization, focuses Liatir and opens a global approval dialog naming
client, workspace, pipeline, run and supplied values. Approval revalidates the
same revision, input-schema snapshot and current artifact permissions, then
runs an execution-only copy through the existing common execution spine; denial creates no
execution, Job or Result. The stable MCP identity and initiator metadata flow to
every child run, Job and terminal Result. Run- and Job-origin cancellation are
limited to MCP-owned roots, while different pipelines remain independent. Restart/workspace recovery
settles durable requests from actual execution state or marks them interrupted
instead of leaving false running state.

The Rust server persists bounded request and audit indexes plus atomic policy;
the token-bearing config is mode `0600` on Unix. Exact bearer comparison,
strict optional loopback Origin validation, private zero-TTL resource responses,
revision checks at request and approval, and a separate Plugin boundary close
the threat model. Disabling or revoking denies requests still awaiting approval
but deliberately does not kill already approved scientific work. The full
state ownership, threats and exclusions are in
[Controlled local MCP boundary](../truth/architecture/mcp.md); public setup and
troubleshooting are in `docs/mcp/overview.md`.

The real official TypeScript MCP client 2.0.0 negotiates protocol `2026-07-28`.
Its common Gate 8 scenario now passes `1/1` against both the native Windows app
and an independently compiled Linux x86_64 app. It preserves every earlier
check — exact input discovery for every family above, the closed
compatible-installed AI Model selector and unavailable-model rejection,
artifact-ID overrides, approval, ungranted/unknown-input rejection, FastQC
lifecycle/cancellation, sanitized and bounded reads, separate Result/Data
permissions, owner-aware cancellation, denial, stale grants, immediate
revocation and audit.

The same scenario adds a saved `seqkit-stats` pipeline. A 17-record FASTQ is
registered from a path containing a space; its artifact and numeric thread
value appear in the frozen schema and approval window. The approved run creates
one Native Tool Job and exactly one terminal Result, keeps the MCP root and
initiator in the Pipeline Run, child, Job and Result, reports 17 sequences,
keeps status/log/Job/Result/artifact resources path-safe and leaves the saved
pipeline unchanged. On Windows the test asserts `execution === "wsl2"`, so the
successful Result proves `MCP client -> liatir.exe -> saved pipeline -> Job ->
bundled SeqKit through WSL2 -> Result`. On Linux it asserts
`execution === "native"` against an ELF app built and run under Xvfb from
`/home/lorenzo/liatir-stack-gate8-mcp`, never `/mnt/c`.

Both platforms pass `npm run test:verify` at 57 files / 342 tests. Their full
UI profiles are each 5 suites passed / 0 failed / 2 platform-skipped, with the
native Tauri E2E sub-run at 33 passed / 0 failed / 23 skipped. Windows Rust is
80 passed / 2 ignored; Linux Rust is 79 passed / 2 ignored; Clippy exits 0 on
both at the existing warning baseline. The earlier macOS arm64 targeted proof
remains 1/1; its separate full-profile WebDriver `SIGABRT` remains recorded as
the failure it was rather than being inferred green from either platform.

The gate found two product defects and one test defect. SeqKit's aligned output
shifted scientific columns when the first file column contained spaces; the
parser now rejoins only excess leading fields and has a 17-record regression.
An unregistered WSL absolute path could survive raw MCP output sanitization;
unknown absolute-path scalars are now redacted, with Rust coverage for WSL and
Windows forms. The first Windows assertion incorrectly expected the Native Tool
child to have `runKind = "pipeline-step"`; the product correctly recorded
`native-tool`, so only the test changed. A fresh Linux clone additionally
needed its documented nested npm prerequisites, and Ubuntu 26.04's Python
3.14.4 was correctly outside the Python fixture's `<3.14` contract; the final
full-profile run used an isolated Pixi Python 3.12.14 on `PATH`.

No shared WSL execution/cancellation code changed, so no conditional Nextflow
rerun was required. No heavy model, GPU workflow, remote workflow, signing,
publishing, deployment or release action ran. Exact OS/toolchain versions,
archive digests, commands and attempt history are in
[Gate 8 MCP — Windows and Linux evidence handoff](../history/gate-8-mcp-windows-linux.md).

## Quenta could never explain a Result, and its own guard was why (2026-08-20)

Five stored conversations show five `explain-result` attempts and five identical
failures. This was not intermittent: the feature failed every time it was asked.

`quentaResponseNeedsPlainLanguageRepair` exists to keep Quenta from answering a
biologist like a maintainer — no shell command to run, no stack trace to read.
Three of its patterns instead matched the vocabulary of the answer the feature
exists to produce: a bare code fence, which is formatting and which any model
reaches for when quoting a value; the bare word "executable", which is an
ordinary way to name the tool that ran; and "JSON file", when saying where a
result was written *is* the answer. A good explanation was therefore rejected,
the repair pass produced the same kind of text, and the second rejection replaced
everything with an apology.

The guard now keys on developer instructions and diagnostics only. The specific
shell and error patterns still match inside a fenced block, so dropping the fence
rule costs no protection.

The missing test is the more important finding. The guard was covered by an
assertion that it *catches* developer-facing text and by nothing asserting it
*passes* legitimate scientific text — so the half that was broken was the half
nobody checked. Both directions are covered now, with realistic result
explanations as the fixtures.

### Sources are the user's own Jobs and Results, and nothing else

Decided by the maintainer on 2026-08-20. A source is something in the user's
workspace they can open and check. Documentation, curated biology knowledge and
the app's own description of itself still reach the model and still shape the
answer, but they are background knowledge rather than evidence about the user's
experiment, and listing them both misdescribed the answer's provenance and buried
the entries that let the user verify it. `isUserVisibleSource` filters the panel;
retrieval and the prompt are unchanged. Pipelines, AI Models and API connectors
are excluded too, deliberately and per that decision, though they are the obvious
candidates if the rule is ever widened.

The sources panel hides itself when the list is empty, so a general question now
shows no sources rather than an empty box.

### Two of the five gated Quenta specs were switched off over a bug, not a gap

Corrected on 2026-08-20. The Windows session recorded all five specs behind
`LIATIR_E2E_QUENTA_UNIMPLEMENTED` as specifying "behaviour the product does not
have". That is true of three of them and false of two, and the distinction
matters because switching a spec off is how a defect stops being visible.

Genuinely unimplemented — the **structured report**, which is a different feature
from `explain-result`: a document with an executive summary, fixed sections, a
trailing `Sources: [...]` line and an export action. `LiatirQuentaIntent` has
only `chat`, `explain-result` and `explain-failure`; `intentFromParam` degrades
`?intent=report` to plain chat; and `result-report`, "Structured report",
"Export report" and "Executive summary" have zero occurrences in the frontend.
Three specs depend on it: the separate report window, the report deep link and
the cited report generation.

Not unimplemented — chat management (rename, tags, search, deletion) and
reattaching to an in-flight response after reload. All fourteen selectors the
chat-management spec uses exist in the product, as do all six the reattach spec
uses. Run in isolation, each with its own app process, both fail on the same
thing: **after a reload the selected chat is not restored**. The failure
screenshot shows Quenta on "Choose a chat" with the conversation present in the
sidebar and unselected, so the app is wrong and the specs are right.

The selection-persistence code exists — `rememberSelectedConversation`,
`storedSelectedConversation`, and `newConversation` does call the creating path
that stores it — so this is a defect rather than a missing feature.

### Fixed: an in-flight response was invisible to every other window

A Quenta response is executed and owned by the Rust bridge — `lia_quenta_ollama_chat`
with a `lia_quenta_ollama_chat_status` companion — so it keeps running when the
window that started it is closed. `recoverActiveRequests` nevertheless carried a
once-per-JavaScript-context latch: the first call set it and every later call
returned immediately.

The effect, reported by the maintainer and reproduced from the code: open a chat
in a separate Quenta window, close it, then go to the Quenta page from the main
window. That window had already visited Quenta, so its latch was closed; the page
called `init()`, `init()` called recovery, and recovery did nothing. The response
was still running in Rust and nothing went to ask. Reloading was the only way to
see it, because a reload builds a fresh context and reopens the latch — so the
workaround was also what hid the cause.

The latch is now an in-flight promise guard: concurrent calls are deduplicated,
later calls are not blocked, and every entry to the page re-checks what is
actually running. Conversations this context is already streaming are skipped so
re-entry cannot attach a second reader.

### Still failing: reload immediately after starting a response in a new chat

The reattach spec still fails in isolation after that fix, and it is a different
problem: a reload builds a fresh context, so the latch was never involved. The
screenshot shows the conversation persisted in the sidebar, no selection, and no
reattachment.

Ruled out so far: the mock finishing too early (it holds the first chat for three
seconds), the descriptor being written too late (`rememberActiveRequest` runs
before the runtime call), and an origin change across the reload (it is
`location.reload()`, same origin, so `localStorage` survives). Remaining
suspects, unconfirmed: the recovery filter compares `descriptor.workspaceId`,
taken from `conversation.workspaceId`, against `workspaceStore.activeId`, and a
mismatch would silently drop the descriptor; or `chatStatus` returns null and the
request is forgotten. Confirming needs instrumentation.

Real-world shape, if it is a product defect: reloading immediately after starting
a response in a brand-new chat may lose the reattachment. Reloading a chat that
already existed does work, which is why it went unnoticed.

Running the whole `quenta.e2e.mjs` file with the gate open is not a usable
signal: one genuinely-unimplemented spec leaves the app closed and every later
spec fails with a bridge error. Isolate before concluding.

### Still open

A stored chat holds one user message and the same assistant reply three times.
Duplicate handling exists for focused chats and for stop/retry, so this is a
different path. Not investigated.

## Six product defects found by using the app, none by the suite (2026-08-20)

Manual use of the built app surfaced six defects that every automated gate had
been green through, before and after the fix. That is the finding worth keeping:
the suites cover the paths they were written for, and each of these lived just
outside one.

- **fastp could not run on a clean install.** The tool pages composed
  `${paths.data}/tool-outputs` and passed it as an output argument, but nothing
  created the directory. Only jobs whose output is captured through `stdoutPath`
  got one created for them, so the directory existed as a side effect of having
  run bwa or minimap2 first — and fastp and bcftools-filter worked on a
  developer machine and failed on a new one. All five pages now call one shared
  `ensureToolOutputsDir()`.
- **Two viewers reported `No such file or directory (os error 2)`.** The install
  marker for a viewer runtime lives in `_app/viewer-runtime-installs`, outside
  the runtime directory, so trashing the payload left the marker behind and the
  store reported a runtime as installed whose files were gone. The store now
  verifies the entry file before trusting a marker, and the loader turns a failed
  read into "not installed" so the existing install prompt fires instead of a
  filesystem error. This was a live violation of release-blocking scenario 7.
- **Quenta attached sources to an answer it had not produced.** When the
  plain-language repair failed, the content was replaced with an apology while
  the citation list fell back to the first four retrieval candidates — four
  documents presented as the basis of an explanation that never existed.
- **Quenta's own usage documentation competed with the science.** The retrieval
  corpus indexes all of `docs/`, so the pages describing how to *ask* for a
  result explanation matched a result-explanation query almost perfectly and were
  cited back at the user. They are now excluded from focused explanations and
  kept for free-form questions, where they are the answer.
- **The file picker was unreadable.** The metadata line sat in a `shrink-0`
  container, refused to yield width, and crushed the text column until the
  compatibility reason wrapped one word per line.
- **A fourteen-minute AI job showed no logs at all.** Python processes were
  spawned without `PYTHONUNBUFFERED`, and CPython block-buffers into a pipe —
  which is exactly how a Job captures stdout. Progress went into an 8 KB buffer
  and was released at exit. The variable is now set in `runtime_python_env`, so
  every Python path streams, not only AI Tools. This one contradicted the
  "Verified" status of the Jobs log/progress transport in the readiness ledger:
  the transport worked, but nothing was ever handed to it until the process
  ended.

Regression coverage was added where it can be pinned cheaply: a Rust test
asserting the unbuffered environment (and that the map is never empty, since the
spawn path drops an empty one and would take the flag with it) and a TypeScript
test for the Quenta self-documentation predicate. The viewer store and the picker
layout are not covered — the first needs store mocking and the second is layout.

Gates after the fixes: `test:verify` 53 files / 319 tests, `cargo test` 59 passed
/ 2 ignored, `cargo clippy --tests` exit 0, `npm run test:ui` 31 passed / 0
failed / 24 skipped.

## Gate 7 is closed, re-scoped to the local desktop matrix (2026-08-20)

Gate 7 carried two halves with different blockers: the local desktop matrix,
which is engineering, and the signed public release, which is credentials, money
and a distribution decision. Keeping them in one gate meant finished, fully
executed and cross-verified work stayed open indefinitely behind a purchase.

**Gate 7 is therefore complete at the local layer.** Every platform claimed by
Beta 1 — macOS arm64, Windows x86_64, Linux x86_64 — has its own package gate,
two-process migration/recovery/uninstall proof, updater and Job-safety coverage,
both lighthouse regressions, green quality gates and accurate public
documentation, all executed rather than inferred from a build.

Signing, notarization, clean-machine installation and a real signed A-to-B
update moved to
[Release gate — signed public distribution](./roadmap/release-signed-distribution.md),
which is open and deliberately not started. The re-scope changes what Gate 7
claims; it upgrades no artifact. Every local package remains unsigned and
unpublishable. Gate 8 MCP is no longer queued behind a purchase.

The release gate is deliberately unnumbered: this knowledge base already uses
"Gate 8" and "Gate 9" for Runtime Box CI gates, so a ninth workbench number
would be ambiguous in the documents that reference both schemes.

### Windows will ship through the Microsoft Store

Decided by the maintainer on 2026-08-20, to avoid buying a code-signing
certificate. This is a change of distribution model, not the same work minus the
certificate, and three things must be settled before the route is committed to:
a Store submission does not take the NSIS installer as-is and Tauri emits no
MSIX; a Store app must not carry the in-app updater and Job-safety guard that
Gate 7 verified, so that build needs its own variant and its own evidence; and
MSIX runs the app in a virtualized container, which has to be validated against
an app that downloads and executes managed binaries, creates Python environments
and installs Runtime Boxes. That containment question is the real risk of the
decision, larger than the certificate it saves. Whether the packaged or the
EXE/MSI submission route actually avoids the certificate must be checked against
current Microsoft documentation rather than assumed.

macOS is unaffected: notarization still requires the Apple Developer Program,
and there is no free path to distributing outside the App Store without a
Gatekeeper warning. The Linux half of the release contract is still unwritten.

## The shared Windows and Linux changes are verified on macOS (2026-08-20)

The Windows and Linux session changed code shared with macOS and could not run
any of it on POSIX: the WASI host directory mount and the Python environment id
in the Rust bridge, three Svelte routes, the shared E2E support module, eight
specs, the test matrix and the conf shell resolver. Every macOS gate predating
those commits has now been re-run on `5d35592` with a clean worktree, and every
one passed on the first attempt. No macOS fix was required — the shared changes
are inert on POSIX in practice, not only by construction.

`npm run test:ui` is green on macOS for the first time as a complete profile:
`tauri-e2e` 31 passed / 0 failed / 24 skipped, profile 5 passed / 0 failed / 2
skipped, exactly the counts Windows reports, with the two off-platform lifecycle
suites skipped by their `platforms` declaration. Earlier macOS evidence ran
individual specs and the orchestrated lifecycle gate but never the whole
profile, so this closes a gap rather than repeating a check. `test:verify` is 53
files / 318 tests, matching Windows; `cargo test` is 58 passed / 2 ignored, up
from 54 by exactly the four tests the shared commits added; Clippy exits 0 on
the existing baseline. The ad-hoc DMG gate passed again and with it the darwin
path of the new `confShellInvocation` resolver, and the standalone lifecycle
gate is 1/1 in both native processes.

The real Gate 6 Nextflow regression was re-run on macOS and is 3/3. It had to
be: the earlier macOS 3/3 was recorded under the rule that it stands only until
application code changes again, and the Rust bridge and three routes have since
changed. One macOS behaviour did change, in the safe direction — a WASM host
directory is now preopened under the raw path the caller supplied rather than
its canonicalized form, so the mount matches the path the plugin is handed even
when it crosses a symlink such as `/var` to `/private/var`.

Recorded for a Linux host to settle: the Linux `cargo test` count of 54 in the
Windows/Linux evidence predates the four new Rust tests, so it is stale rather
than platform-conditional, and its "one fewer than Windows" explanation never
matched its own number. macOS measures 58, the same as Windows.

The complete commands, artifact identities and counts are in
[Gate 7 Beta 1 — macOS evidence](../history/gate-7-beta1-macos.md).

## The Gate 7 Windows and Linux slices are complete and executed (2026-08-19)

Both remaining desktop platforms now have their own package gate, lifecycle
proof and executed regression evidence, and the desktop matrix is coherent
across macOS, Windows and Linux at the local, unsigned layer.

`npm run desktop-beta:package:windows` builds the real NSIS installer from a
production-shaped configuration and refuses to accept a signed one: it requires
Authenticode `NotSigned` on the installer, the packaged executable and the
installed executable, since Windows has no ad-hoc signature to stand in for
macOS's. It then performs a real silent per-user installation into a test-owned
directory and lets the generated uninstaller remove it, leaving no registry
entry, Start Menu shortcut or directory behind.
`npm run desktop-beta:package:linux` builds and inspects the `.deb`, `.rpm` and
AppImage the product claims, and requires that no updater signature exists.
`npm run desktop-beta:test:windows` and `npm run desktop-beta:test:linux` share
one lifecycle module and drive the installed copy in two native processes;
macOS keeps its own orchestrator because re-signing a debug WebDriver bundle
changes how macOS launches it. `scripts/build-desktop-release.mjs` now
implements the Windows signing contract — a certificate thumbprint or PFX, an
HTTPS RFC 3161 timestamp server, an NSIS installer plus `.nsis.zip` updater
artifact, and `Get-AuthenticodeSignature` reporting `Valid` with a real
countersignature on both the installer and the executable. Linux remains
deliberately rejected by that contract.

Three defects were found by executing rather than building. A bare
`window.location.reload()` deadlocks WebView2 — the document is torn down before
the script response is sent, so the run sat on the harness's 600-second script
timeout instead of failing, which is how the single-cell lighthouse "hung" on
Windows; `reloadLiatirApp` is now shared support and every spec uses it. On
Windows the `bash` npm's `cmd.exe` finds first is `System32ash.exe`, the WSL
launcher, so generating a Windows build's configuration silently ran inside
Linux and depended on tools installed there; `scripts/run-conf.mjs` now resolves
the Git for Windows shell and refuses that fallback. Finally a Python discovery
test asserted more than the product relies on, failing on the zero-length
`python3.exe` App Execution Alias that Windows 11 ships; the product already
skips it through `--version` validation, and the test now makes the same choice.

`npm run test:ui` is also green on Windows for the first time: 31 passed, 0
failed, 24 skipped, from 19 passed / 17 failed / 19 skipped at the start of the
session. Running every failing spec in isolation before changing anything is
what made that tractable — sixteen of the seventeen failed alone too, so they
were real rather than cross-spec contamination. Five were product defects on
Windows: WASM plugins could read no file at all because host directories were
mounted into the WASI sandbox under a verbatim `\?\C:\...` path; a Python
plugin environment could not be created because `setuptools` pushed a path two
characters past the 260-character limit, which is now fixed at the root: managed
Python environments moved on Windows from the roaming data directory to
`%LOCALAPPDATA%pp.liatir.app\plugin\`, cutting that prefix from 67 characters
to 37 and leaving 34 for a user name where Windows allows at most 20. They are
rebuildable cache, so no migration was needed, and `Roaming` is the wrong place
for machine-specific binaries anyway; macOS and Linux are unchanged. A unit test
now measures the whole path down to the deepest file pip installs; a Result deep
link did nothing when the
user was already on the Results page, because `?run=` was read once on mount
while the app routes client-side; and the AI Models and Quenta screens exposed
their state only as copy. Long-path support was deliberately not enabled, per
the standing rule that it fixes one host and no user; the product trimmed the
path segment it owns instead.

Five Quenta cases remain skipped behind `LIATIR_E2E_QUENTA_UNIMPLEMENTED`. They
specify structured reports, the `report` deep-link intent, and restoring chat
selection and an in-flight response after reload — none implemented yet. They
are kept as the executable specification of that work rather than weakened,
which is what the readiness ledger means by Quenta being "Partial".

The exact package identities, commands, counts and limitations are in
[Gate 7 Beta 1 — Windows and Linux evidence](../history/gate-7-beta1-windows-linux.md).
Gate 7 is still not closed: code signing, notarization and a real signed
A-to-B update on a clean machine remain release blockers on all three platforms.

## The Gate 7 macOS slice is fully executed (2026-08-17)

The two macOS proofs the previous session prepared but could not launch have now
been run against a debug binary rebuilt from the current worktree.
`npm run desktop-beta:package:macos` passed on the current revision, after the
CSP and release-input hardening: it produced `Liatir_0.2.1_aarch64.dmg`,
`codesign --verify --deep --strict` reported the bundle valid and satisfying its
Designated Requirement, `hdiutil verify` reported a valid checksum, and the
mounted image contained the packaged executable. It remains ad-hoc signed, not
notarized, and must not be published. The native corrupt-index recovery spec
passed 1/1.

Running that recovery spec for the first time found a defect in the spec, not in
the application. `WebDriverElement` caches an element id once resolved, so
asking the already-resolved recovery banner whether it is displayed after a
successful retry queries a removed node and raises a stale element reference
instead of reporting absence. The failure screenshot showed the app had
recovered correctly while the assertion reported failure. The spec now
re-queries the element each poll and asserts absence through `isExisting`.

A second defect was in suite ownership. `desktop-beta-macos-install` and
`desktop-beta-macos-recover` shipped without `requiredEnv`, and the native
runner globs the whole spec directory when given no spec arguments, so both
would have run inside `npm run test:ui` against an unseeded home and failed
while the orchestrated Gate 7 proof passed. Every other orchestrator-owned spec
already declared the guard. Both now require `LIATIR_DESKTOP_BETA_LIFECYCLE`;
the lifecycle proof is a declared `desktop-beta-lifecycle-e2e` suite in the `ui`
and `all` profiles; the matrix runner accepts a `platforms` declaration and
skips an off-platform suite instead of failing it, so the Windows session can
add its own package/lifecycle suite the same way; and
`tests/unit/e2e-spec-loading.test.ts` now fails if any orchestrator-owned spec
stops declaring `requiredEnv`.

Evidence: `npm run test:verify` 52 files / 306 tests with every build and type
gate green, `cargo test` 54 passed / 2 intentionally ignored,
`npm run desktop-beta:test:macos` both native processes 1/1, and Gate 5
single-cell 1/1, updater/Job-safety 1/1 and scientific-artifact 1/1 against the
rebuilt binary. The real Gate 6 Nextflow regression was not re-run because no
application code changed after its recorded 3/3; only specs and the test matrix
did.

Gate 7 is still not closed. Developer ID signing, Apple notarization, a real
signed A-to-B update on a public package, and the Windows and Linux desktop
matrices remain release blockers.

## Gate 7 Beta 1 is in progress; the local macOS slice is implemented and verified (2026-08-14)

The production desktop path now bundles the frontend instead of depending on a
hosted UI. Settings exposes a user-triggered Tauri updater flow; the native
bridge serializes checks/installs and refuses application replacement or
restart while a scientific Job is running; an exclusive lifecycle guard also
prevents a new Job from appearing between the final check and replacement.
Startup migration failures now keep
data in place and show retry/support recovery instead of leaving a permanent
spinner. A release-build entry point requires an exact clean revision, HTTPS
feed, updater signing keys and platform signing/notarization inputs, and never
publishes artifacts itself.

Local macOS arm64 evidence is complete at the non-release layer. An ad-hoc
signed DMG was built, code-signature checked, checksum verified, mounted and
inspected. Native tests passed for the explicit updater and Job guard (1/1),
the Gate 5 single-cell lighthouse (1/1), real Gate 6 Nextflow standalone and
pipeline behavior (3/3), and two-process migration/recovery/uninstall retention
(2/2 processes). Removing the temporary app preserved migrated state and both
legacy and newly produced Results. Public installation, first-analysis,
limitations and troubleshooting pages were added.

Gate 7 is not closed. This machine has no Developer ID identity or Apple
notarization credentials, so the local DMG is explicitly non-publishable and no
real signed updater A-to-B transition is claimed. A clean-machine signed and
notarized macOS proof plus native Windows and Linux desktop package/lifecycle
evidence remain release blockers. The exact evidence and Windows/WSL handoff
are in [Gate 7 Beta 1 — macOS evidence](../history/gate-7-beta1-macos.md).

## Nextflow External Workflows are cross-platform complete (Gate 6, 2026-08-14)

Liatir now has a first-class, workspace-scoped External Workflow definition in
the shared core. A definition owns its Nextflow engine, local snapshot or
version-pinned repository source, typed parameters, staged inputs and exact
declared outputs. The same saved definition is runnable from Tools / External
Workflows and reusable by ID as a Liatir pipeline node; it is neither a `.lia`
Plugin nor an ordinary Native Tool.

Every run gets an isolated staging area and one workflow-level Job. Source,
optional config and inputs are copied without mutating originals, symlinks are
rejected at the staging boundary, and only exact declared outputs become
reusable artifacts. Direct runs own a top-level External Workflow Run and
Result. Pipeline runs use the same adapter and retain both their External
Workflow Run identity and `pipelineRunId`. Nextflow process tasks remain nested
observability rather than unrelated top-level Jobs.

macOS and Linux keep the native POSIX backend. On Windows the bridge now owns an
explicit supported `liatir.exe -> wsl.exe -> Nextflow` backend. It probes the
selected WSL distribution, requires WSL2 Linux x86_64 plus Java and Nextflow,
maps only validated absolute Windows paths with `wslpath`, and persists a
run-owned runtime/control record. A fresh Linux session and token identify each
run's process group. Cancellation writes a marker, sends TERM with a bounded
wait, escalates to KILL when needed, and does not terminate the distribution or
unrelated WSL work. Startup cleanup accepts only valid run control records and
token-matched processes before exactly-once Result reconciliation. Output
collection and hashing remain on the Windows host and publish only the paths
declared by that run.

Results preserve engine and Java versions, source/revision and digests,
parameters, profile/configuration, environment, command, work/output paths,
logs, trace, report, timeline, DAG, session ID, task states, output digests and
exit code. Failure and cancellation remain inspectable. Engine-native resume is
an explicit expert action accepted only against a compatible saved definition,
and interrupted runs reconcile exactly one Result after restart.

Cross-platform closure evidence is recorded in
[Gate 6 Nextflow cross-platform evidence](../history/gate-6-nextflow-cross-platform.md).
The previously verified macOS arm64 path remains unchanged. On Windows 11 Pro
x86_64 (build 26200), the real native app used WSL 2.7.10.0, Ubuntu 26.04 LTS,
Linux `6.18.33.2-microsoft-standard-WSL2`, Nextflow `26.04.6 build 12646`, and
OpenJDK `21.0.11`: the focused product suite passed 3/3 and the separate
two-process restart suite passed 2/2 phases. `npm run test:verify` passed 51
files / 296 tests; `cargo test` passed 53 tests with two intentional Runtime Box
ignores; `cargo clippy --tests` exited successfully on the existing warning
baseline.

The independent checkout at `/home/lorenzo/liatir-stack-gate6` was inside the
WSL Linux filesystem. Its newly compiled app was confirmed by `file` as an ELF
64-bit x86-64 PIE executable, and the focused E2E passed 3/3 under Xvfb.
`npm run test:verify` passed 51 files / 296 tests, `cargo test` passed 52 tests
with two intentional ignores, and `cargo clippy --tests` exited successfully.
Gate 6 is therefore cross-platform complete for macOS arm64, native Linux
x86_64, and the native Windows x86_64 app using WSL2 Linux x86_64. This does not
claim native-Windows Nextflow, WSL1, WSL ARM64, managed Nextflow installation,
or HPC/cloud executors. Gate 7 has now started with the macOS slice recorded
above.

## The single-cell lighthouse is complete (Gate 5, 2026-08-13)

The Single-cell Embedding Tool now hands its profiled immutable AnnData output
and bounded embedding preview directly to the single-cell viewer. The viewer
preserves artifact identity, validation and embedding-key provenance and plots
a deterministic PCA preview of at most 1,000 cells. It explicitly does not
present this bounded preview as full-dataset UMAP, clustering or annotation.

Results can register the output AnnData and preview in Data and reopen them in
the standalone viewer. The saved `single-cell-embedding-viewer-v1` preset wires
the typed Tool outputs to the viewer, so a non-technical user only chooses the
input AnnData and an installed supported AI Model. Direct and pipeline runs use
the same artifact finalizer, provenance and viewer hints.

Final local evidence is `npm run test:verify` (48 unit files / 279 tests),
`cargo test` (46 passed / 2 intentionally ignored), `cargo clippy --tests` with
the existing warning baseline, the 1/1 native Gate 5 suite, the unchanged 1/1
scientific-artifact suite, 10/10 pipeline lifecycle and 5/5 common execution
spine. Existing tracked Runtime Box publication and product-lifecycle evidence
remains the model layer; no heavy model was downloaded or run for this UI and
orchestration gate. Gate 6 subsequently completed its macOS implementation and
native proof, as recorded above.

The focused native Gate 5 and regression suites passed after the main
implementation. Two later parser/PCA edge-case corrections pass unit tests and
`test:verify`; the focused suite was rerun against the final Gate 6 binary and
remained green 1/1.

## Scientific I/O is standardized for AnnData (Gate 4, 2026-08-13)

`packages/liatir-core` now owns the optional, versioned scientific artifact
contract and the first profile, `org.liatir.scientific.anndata@1.0.0`. Profile
minor and patch revisions are backward-compatible within their major version;
legacy file and Result records remain readable without metadata. Compatibility
is reported separately for physical transport, concrete format and scientific
meaning, and unknown facts remain partial instead of being guessed.

The native file bridge streams byte size, SHA-256 and the HDF5 signature without
loading large datasets into the webview. Data persists the profile and detects
content changes; relevant direct and pipeline selectors expose validation and
disable known incompatible choices. Results show profile, scientific type,
digest and transformation lineage and retain the full machine-readable record.

The Single-cell Embedding AI Tool declares AnnData input/output semantics for
Geneformer, scGPT and UCE. Both direct and pipeline runs re-hash inputs before
compute, reject known organism, modality, feature-namespace or preprocessing
mismatches, and produce a distinct immutable output with model parameters,
source revision, embedding hints and source lineage. The original AnnData file
is never silently rewritten.

Final local evidence is `npm run test:verify` (47 unit files / 272 tests),
`cargo test` (46 passed / 2 intentionally ignored), `cargo clippy --tests` with
the existing warning baseline, the new 1/1 native scientific-artifact suite,
the unchanged 10/10 pipeline lifecycle suite and the 5/5 common execution-spine
suite. The broad UI baseline was not rerun and its previously recorded unrelated
failures are unchanged. Gate 5—the full single-cell viewer handoff, downstream
reuse and one useful no-code preset—is now the active boundary.

## The common execution spine is complete (Gate 3, 2026-08-11)

`packages/liatir-core` now owns one versioned execution identity and lifecycle
contract for Pipeline Runs, pipeline steps, standalone runs and nested runs. An
identity is allocated before work starts and carries stable workspace, root,
parent, Pipeline Run, node and entity ownership into Jobs, Results and artifact
provenance. The same contract already reserves standalone and nested External
Workflow Run identity without implementing Nextflow early.

Execution state is durable and workspace-scoped. Terminal transitions are
first-writer-wins, Result publication is idempotent, and startup reconciliation
either adopts the already durable Result or creates exactly one interrupted
Result. Cancellation follows only the selected run tree and its Jobs. Pipeline
children use the same identities and cannot release downstream work or publish
their parent Result before terminal child settlement and durable output
registration.

Direct AI Model, Plugin, API Connector and Native Tool execution now use this
spine. All current standalone Native Tool pages run through the shared Jobs
backend; their logs, progress, cancellation and Results retain the same
identity. In-process WASM Plugin calls, including FastQC, now create real Jobs
with progress, buffered logs and cancellation. Managed dependency work is
separately owned and interrupted downloads retain verified partial bytes for a
real HTTP Range resume.

Final local evidence is 44 unit files / 257 tests through
`npm run test:verify`, `cargo test` (45 passed / 2 intentionally ignored),
`cargo clippy --tests` with the existing warning baseline, the unchanged
10/10 pipeline lifecycle suite, the 5/5 common-spine native suite, and the
two-process restart suite. Restart recovery covers one active pipeline plus
direct AI Model, Plugin, Native Tool and API Connector runs, then repeats after
reload without duplicate Results.

The broad `npm run test:ui` baseline is not globally green: 21 passed, 11
failed and 8 were skipped. Every Gate 2/3 lifecycle case passed; the failures
remain in stale AI catalog expectations, the intentionally hidden Dependencies
sidebar route and Quenta reload/selection tests, where the first selection
failure cascades into later cases. These are separate readiness work and are
not represented as Gate 3 evidence. Gate 4 subsequently closed the versioned
AnnData scientific artifact contract, as recorded above.

## Asynchronous pipeline settlement is complete (Gate 2, 2026-08-11)

Pipeline spawn acknowledgement is no longer treated as completion. Native
Tools, Node/Python Plugins and AI Tools now share one Job settlement barrier:
the node remains `running` until the child Job is terminal, then performs a
final buffered-output drain so late diagnostics and Plugin result markers
cannot be lost. Pipeline Plugin Jobs carry workspace, parent run, pipeline and
node identity and are killed with their owning pipeline. WASM Plugins remain a
synchronous invocation and receive cancellation checkpoints before and after
that settled call.

API Connector requests, including OAuth token acquisition, now receive the
pipeline abort signal. API, Plugin and Tool outputs must exist and be durably
registered in Data before the node becomes `done`. The persisted terminal node
state is flushed before the grouped Result is published, so a Result cannot be
observed while its node still appears `running`. Sub-pipelines now execute API
and nested sub-pipeline nodes instead of silently skipping them, propagate child
failure/cancellation, and keep their parent node running until child outputs
settle.

Beta 1 scheduling is deliberately unchanged: nodes within one pipeline execute
sequentially, while independent pipelines remain concurrent. Native Tauri E2E
proves an independent pipeline actually completes while another is active,
spawn does not release downstream work, Native Tool Jobs are ordered by their
terminal timestamps, and Plugin/API/sub-pipeline success, failure,
cancellation, navigation and durable output registration all settle correctly.
The lifecycle suite is 10/10. A separate lightweight two-process native suite
starts an API pipeline, terminates the first app while its request is active,
then proves the second app reconciles exactly one interrupted Result and never
runs the downstream node; both phases pass.

Gate 2 evidence at closure was 40 unit files / 243 tests, `npm run test:verify`,
`cargo test` (44 passed / 2 intentionally ignored), `cargo clippy --tests` with
the existing warning baseline, the 10-case native lifecycle suite, and the
two-phase restart suite. Gate 2 is complete; Gate 3 subsequently closed the
common pipeline/run/result spine and nested-run contract as recorded above.

## Runtime Box update security is cross-platform complete (Gate 1, 2026-08-11)

The install bridge now owns one app-global, atomic
`runtime-box-control-floors.json`. Mutable signed channels are separated by
Registry, channel, box and target; the complete revocation set is separated by
Registry. Each floor records the signed `updatedAt` instant and exact
`payloadSha256`. Older generations are rejected as replay, equal timestamps
with another digest are rejected as equivocation, and a revocation document
cannot silently disappear after one has been accepted. A corrupt or unreadable
state file blocks new installs and updates with a fail-closed diagnostic; it is
not consulted when an already installed Runtime Box executes its immutable
signed release.

`npm run runtime-box:test:security` is a lightweight native product proof, not a
model download. It creates signed schema-v2 versions A and B and uses two native
Tauri processes over the same isolated app-data root. The unchanged macOS arm64
proof and the new native Windows x86_64 and WSL2 Linux x86_64 proofs all pass A
install, true A-to-B update, rollback to A, persisted floors after app restart,
old/equivocal channel and revocation rejection, refusal when an accepted
revocation later returns 404, corrupt-state blocking for both updates and fresh
installs, and continued offline execution of installed A.

The Windows proof used the real `liatir.exe` and the fixture's minimal native PE
launcher. The WSL proof first confirmed `uname -m = x86_64`, then compiled a
separate Tauri application entirely inside WSL and verified it as an ELF64
x86-64 executable before running the same two-process suite under Xvfb; no
Windows executable was used as Linux evidence. Windows Rust evidence is 21
passed / 2 intentionally ignored and Linux is 19 passed / 2 intentionally
ignored. `cargo clippy --tests` passed on both hosts with the existing warning
baseline, and `npm run test:verify` passed 38 files / 236 tests plus every build
and type gate. The suite remains part of the `ui` and `all` profiles. Gate 1 is
complete on macOS arm64, native Windows x86_64, and Linux x86_64 in WSL2.

## Scrollcase P5 adoption is complete (P5.7, 2026-08-11)

The Scrollcase handoff is closed, with four states kept deliberately separate:

- **Extraction:** Scrollcase P1–P4 is complete in the independent Apache-2.0
  project; no Scrollcase source or generic builder remains in Liatir.
- **Adoption:** Liatir P5 is complete on exact `scrollcase@0.8.0` and
  `scrollcase-consumer 0.3.2`, using only published surfaces and schema v2.
- **Validation:** three models, nine product targets and three foundation
  fixtures make up the current inventory; every product target has its required
  native/scientific evidence, and P5.6 adds the final reviewed local product
  lifecycle on scGPT macOS Metal.
- **Publication:** all nine targets are KMS-signed, immutable and selected on
  `beta`. The two superseded Geneformer/scGPT `beta.1` versions are revoked;
  unselected UCE `1.0.0-beta.1` still requires a separate decision if explicit
  revocation is desired.

The operator command surface has not changed. Scrollcase owns generic authoring,
build and verify; Liatir owns CI/evidence, signing integration, Registry/R2,
promotion/revocation and the product lifecycle. The local candidate Registry's
`serve` command now supports HTTP byte ranges for real resume testing. P5 has no
remaining gate. The next Runtime Box product slice was app-global
anti-replay/version-floor state; its macOS implementation and product proof are
now complete as recorded above, together with native Windows x86_64 and WSL2
Linux x86_64 evidence. The common pipeline/run/result spine follows. None of
this is continued Scrollcase migration.

## Scrollcase adoption has native closure (P5.6, 2026-08-11)

P5.6 is complete on exact public `scrollcase@0.8.0`. From a checkout with no
generated Runtime Box state, the committed lockfile installed cleanly; the full
cheap/type/build/Rust gates passed; and the synthetic v2 fixture completed
deterministic build, verify/self-test, combined Node/Rust consumer, activation,
rollback and removal while its signed v1 counterpart was rejected.

The reviewed non-production product proof used scGPT Whole-human
`0.2.5-beta.2` on `macos-aarch64-metal`. A clean, locally signed candidate
(archive SHA-256 `7b4c9a9f…`, `527233742` bytes; installed `1372956773` bytes)
ran through the real compiled Tauri app. The five-minute E2E receipt is green:
interrupted download and resume, install/self-test, real Apple Metal inference,
Job `job_1`, three finalized Result artifacts and provenance, replacement,
rollback, v1 rejection on inline and Job execution, bounded removal, and Result
artifacts surviving the runtime. All thirteen assertions passed.

The run closed two product-path gaps. Inline Python execution now applies the
same activation schema gate as Job execution, so installed v1 state cannot run.
The loopback candidate Registry now honors single HTTP byte ranges (`206` plus
exact `Content-Range`) instead of forcing a resumed download back to zero; unit
coverage includes open, bounded, suffix and invalid ranges, and a real archive
probe confirmed `bytes 128-255/527233742` before the successful lifecycle.

Final local evidence is 38 unit files / 234 tests, catalog 3 models + 3
foundation fixtures, signer 15/15, foundation 1/1, Rust Runtime Box 18 passed /
2 ignored, full `test:verify`, and lint with zero errors (43 existing warnings).
All Runtime Box generated state and temporary processes were removed. Nothing
was production-signed, published, promoted, deployed, or changed in trust,
catalog or channel state. P5.7 subsequently reconciled the documentation and
operator handoff, closing the Scrollcase P5 adoption plan.

## The re-release is complete: all nine targets are published (2026-08-10)

Every Runtime Box target is published and promoted on the `beta` channel, signed
by `liatir-runtime-box-kms-2026` under the v2 envelope. Verified against the public
registry rather than inferred from run logs — nine of nine channels serve the
expected version:

| Box | Target | Version | Release run |
|---|---|---|---|
| geneformer-v1-10m | macos-aarch64-metal | 1.0.0-beta.2 | `31229152183` |
| geneformer-v1-10m | linux-x86_64-cuda12.9 | 1.0.0-beta.2 | `31325208258` |
| geneformer-v1-10m | windows-x86_64-cuda12.8 | 1.0.0-beta.2 | `31339302550` |
| scgpt-whole-human | macos-aarch64-metal | 0.2.5-beta.2 | `31228656398` |
| scgpt-whole-human | linux-x86_64-cpu | 0.2.5-beta.2 | `31347244733` |
| scgpt-whole-human | windows-x86_64-cpu | 0.2.5-beta.2 | `31348613035` |
| scgpt-whole-human | linux-x86_64-cuda12.9 | 0.2.5-beta.2 | `31350903591` |
| scgpt-whole-human | windows-x86_64-cuda12.8 | 0.2.5-beta.2 | `31354595144` |
| uce-4layer | macos-aarch64-metal | 1.0.0-beta.2 | `31230276512` |

Each carries a reviewed evidence record under `runtime-boxes/evidence/`, and every
Linux and Windows target's receipt covers the complete product lifecycle: ten
assertions — interrupted resume, install, real inference, Jobs, Results,
provenance, replacement, rollback, removal, and Result artifacts outliving the
runtime — all passing. `liatir-core` lists every published target, so the installer
offers them.

**The two superseded versions are withdrawn (2026-08-10).**
`geneformer-v1-10m 1.0.0-beta.1` and `scgpt-whole-human 0.2.5-beta.1` are no longer
installable. `GET https://models.liatir.com/v1/revocations` serves one document signed
by `liatir-runtime-box-kms-2026` carrying **both** entries, each with its own reason —
verified by reading the public registry, not by trusting the run. Done by
`.github/workflows/runtime-box-revoke.yml`, run `31401308564`, all thirteen steps green.

Three things had to be fixed first, and none was visible from the commands:

1. **Promoting the second revocation erased the first.** `revoke` wrote a document
   holding one entry, and the Worker `put`s it at `control/revocations.json` whole, with
   no merge — the documented revoke/promote pair, run once per model, left only the
   second revocation live and silently restored the first box. The Worker *cannot*
   merge: the object carries one signature over one exact byte string, so appending an
   entry server-side would invalidate it. Completeness is the signer's job, and `revoke`
   now enforces it two ways — `--box`/`--version` repeat so one signature covers several
   boxes (`--from <file>` takes the same entries as JSON, which is how the workflow
   passes them), and whatever the registry already serves is verified and carried
   forward. `--no-carry-forward` opts out for local and loopback use. Regression
   coverage in `tests/unit/runtime-box-scrollcase-adapter.test.ts` pins both properties,
   plus the rule that an unreadable live set fails instead of being read as empty.
2. **There was no revocation workflow.** Signing needs an audience-bound identity token
   and promote needs the Registry admin token; both live in the `runtime-box-production`
   environment, so the action ran nowhere rather than depending on a workstation holding
   production keys. The workflow validates and echoes the plan before anything is
   signed, then reads `/v1/revocations` back from the public registry and fails unless
   it serves every requested entry. It shares the `runtime-box-production` concurrency
   group with the release workflow, since both mutate the same control objects.
3. **A protected workflow is inert until its own WIF provider exists.** The first
   dispatch (run `31378512709`) validated the plan, then died at auth with
   `unauthorized_client: The given credential is rejected by the attribute condition`.
   Every provider condition in `configure-runtime-box-ci.sh` pins one exact
   `workflow_ref` — that is what stops a token minted for one workflow being usable by
   another — so `runtime-box-production` accepts the release workflow and nothing else.
   The fix was a third provider, `runtime-box-revocation`, under the same Environment,
   exported as `GCP_REVOCATION_WORKLOAD_IDENTITY_PROVIDER`; widening the release
   condition to name a second workflow would have traded that guarantee for one fewer
   resource. No extra IAM followed: the principal set is keyed on
   `attribute.environment`, so the provider resolves to the release service account,
   which already holds Cloud Run Invoker on the signer.
   `tests/unit/runtime-box-ci-identity.test.ts` now fails if a workflow authenticates to
   Google without a provider naming it.

Two notes for whoever provisions this next. `configure-runtime-box-ci.sh` is idempotent
but re-runs `update-oidc` over the *existing* providers, so confirm the conditions it
would regenerate match production before running it — for the release and signer
providers they did, byte for byte. And a maintainer workstation cannot stand in for the
workflow: this was checked, not assumed. The Mac's `gcloud` service-account config is
workload-identity federation bound to an expired GitHub Actions OIDC subject token, a
user account cannot mint an audience-bound identity token at all, and
`LIATIR_RUNTIME_BOX_ADMIN_TOKEN` is not present. Production credentials on a workstation
were the wrong fix regardless.

**One old object still needs an explicit product decision.**
`uce-4layer 1.0.0-beta.1` remains publicly addressable as an immutable release
document. It is not selected by the `beta` channel and the v2-only client rejects
it, but it is not present in the live revocations document. Decide deliberately
whether to revoke it; do not infer retirement from the two model revocations above.

## The local generic Runtime Box copies are retired (P5.5, 2026-08-10)

All active build and CI callers now use the public `scrollcase@0.8.0` exports for
workspace resolution, target identity/adapters, deterministic ZIP and filesystem
primitives, builder identity and conda licence parsing. The local generic archive,
filesystem, licences, pixi, standalone-Python/uv, targets and workspace modules,
plus the unused local config schema, are deleted. Their package-owned unit suites
are deleted with them rather than preserving downstream tests of an upstream
implementation. The root no longer directly depends on `tar`, `yauzl` or `yazl`;
they remain transitively owned by Scrollcase.

Liatir still owns the thin command dispatcher, CI/catalog/evidence and heartbeat,
scientific validators, signer command and policy, Registry/R2 distribution and
path containment, product lifecycle, and Rust/Tauri consumer. `identity.mjs` now
contains only the two Liatir distribution-layout helpers that previously drifted
during publication: archive beside release-by-hash and channel-by-channel path.

Static guards fail on a deleted-module import, an unpublished/deep/sibling
Scrollcase reference, or any active catalog scroll carrying `uvVersion`,
`requirementsInput`, `requirementsLock` or `torchBackend`. Final local evidence:
38 unit files / 232 tests, catalog 3 models + 3 foundation fixtures, signer 15/15,
published-build + Rust Zip64 foundation 1/1, Rust Runtime Box 18 passed / 2 ignored,
and `npm run test:verify` fully green. `npm run lint:ts` has zero errors and the
repository's existing 43 warnings. No trust root, signed document, catalog entry,
generated binding, model asset or channel changed. P5.6 subsequently completed
the reviewed non-production native lifecycle recorded above.

## The Rust Scrollcase consumer boundary is closed (P5.4R, 2026-08-10)

`src-tauri` remains pinned to exact `scrollcase-consumer 0.3.2`. Runtime Box
installation now uses `prepare::verify_and_extract_box` with Liatir's compiled-in
`TrustAnchors::Keys`; the returned receipt is required to match the exact signed
release payload already selected, compatibility-checked and revocation-checked by
Liatir. Scrollcase owns the generic second verification, archive identity, safe
extraction, installed size and complete `box.json` agreement. Liatir still owns
Registry/channel selection, product compatibility, revocation, disk planning,
self-test diagnostics, activation, rollback, removal and provenance.

An executable state guard and regression pin verified release → product
policy/revocation → disk → archive → extraction. At P5.4R, persisted anti-replay
was not present; the macOS slice is now complete in the newer status above.
Automatic `attach_extracted_box` is rejected because its `PreparedBox` receipt is
in-process rather than restart-durable; `verify_extracted_payload` is reserved for
a future explicit O(box size) integrity diagnostic; `verify_required_assets`
waits for a real on-demand-assets product path.

Final local evidence: `cargo test runtime_box` 18 passed / 2 ignored,
`cargo clippy --tests` completed with only the repository's pre-existing warning
set, and `npm run test:verify` passed 42 test files / 266 tests plus all build and
type gates. P5.6 subsequently exercised that combined API in the native fixture
and real scGPT product lifecycle; no model, catalog, trust, signed object or
channel changed.

## Current continuation

The Runtime Box migration, nine-target re-release, local desktop Beta matrix and
controlled local MCP Gate 8 are complete. Continue with the evidence-backed
predictive/variant genomics and protein structure/binding verticals, followed by
individually verified Plugin/pipeline templates and then any additional External
Workflow engine through the existing adapter contract.

The [single-cell RNA-seq vertical](./roadmap/single-cell-rnaseq-vertical.md) is
built on the machine: `simpleaf`, `alevin-fry` and `piscem` ship in the bundled
Native Tools box (+31 MB compressed), and two pipeline steps take raw reads to an
`.h5ad` count matrix — the format the single-cell AI Tools already read. simpleaf
writes the `.h5ad` itself, so Liatir has no implementation of the AnnData format
and must never grow one. The box's self-test runs the whole chain and asserts
exact per-cell, per-gene counts, so a box that cannot do single-cell cannot be
packaged.

Ready-made index distribution is now **implemented, locally verified and deployed
through the production control plane**. A manual protected GitHub workflow builds
the approved human GRCh38 / GENCODE v47 / spliced+intronic / R2 91 index from checksummed
sources with the committed Linux Native Tools lock. It packages deterministic,
content-addressed bytes, uploads them to R2 through the least-privilege Registry
admin surface, verifies the public SHA-256, then signs and promotes a catalog
whose policy binds the whole scientific identity. The app presents that identity
in a dropdown, verifies signature/archive/every extracted file, caches the signed
catalog for offline use, reuses a still-valid install, and supports exact removal.
The custom local builder remains for unusual species and releases; both routes
emit the same small manifest (`packages/liatir-core/src/single-cell.ts`), so
quantification did not change.

Local evidence on 2026-08-24: `test:verify` passed 62 files / 415 tests; the
focused Rust tests passed 3/3; the dedicated native index lifecycle passed 1/1
and proved one archive request across install plus reuse, followed by complete
removal; the full `test:ui` profile passed its main 34/0 native cases plus the
declared restart/security/desktop lifecycle suites. The first real human index
was started from exact `main` after authorization. The production Registry Worker
is version `bd570562-1ccf-491f-a779-d94bb0f3986c`; the dedicated Google identity is
active; signer deployment run `32688008078` passed its real KMS smoke test. The
first index run (`32688392977`) exhausted the standard hosted runner disk during
simpleaf, before any upload or catalog promotion. The fixed workflow removes only
explicit unused SDKs from that ephemeral runner and requires 40 GB free before the
large build.

Production activation is now complete. Retry `32689107199` on exact revision
`d0da9c4` passed: cleanup changed free runner disk from 13 GB to 42 GB, the real
build took 64m54s, and the complete release job took 72m59s. The published archive
is 4,714,468,782 bytes with SHA-256
`99072c6b9e4ec8b709b298bc38c0b54d9256aa65323d72c587c1ea160d7f2e8c`; its CI
receipt records a complete public HTTP 200 download with the same size and hash.
The live catalog has payload SHA-256
`cb8e66caa101f5bb65ab28232dbb8441d384ea7a9f0dea1b70bd6f8ae2022d64` and one
`liatir-runtime-box-kms-2026` signature verified independently against the tracked
production key. Independent HTTP read-back returned 200 for the catalog and for
the immutable archive, whose content length matched exactly.

The signed public [Release gate](./roadmap/release-signed-distribution.md)
remains a separate, open path. It starts only with the exact credentials,
notarization purchase and Windows Store packaging decision explicitly
authorized; it does not block the product-engineering sequence above.

P5.0 through P5.7 are complete; the Scrollcase P5 plan is closed.
The canonical detailed ledger is
[Scrollcase P5](../history/scrollcase-p5-liatir-adoption.md). The sections below
this point are retained as implementation history and must not override this
current continuation. Difficulty, recommended Codex effort, platform flags and
gate exit criteria live in the canonical
[Scientific AI Workbench plan](./roadmap/scientific-ai-workbench.md).

## Historical re-release and migration record

## What the re-release cost, and why

Seventeen defects stood between a validated matrix and a published one. Not one was
a fault in a Runtime Box or in the product's science: every one was a path that had
fallen behind the repository and had not been executed since. The pattern is worth
keeping, because it will recur at the next migration.

- **Deployed services outlive their source.** The Cloud Run signer's smoke payload
  still declared schema v1 after the v2 cutover, so every deployment ended red; the
  Registry Worker itself had never been redeployed since `bc99ea3`, and rejected
  every v2 signed document with `invalid_signed_document`. Neither was detectable
  from the repository.
- **The release workflow drifted behind the validation workflow.** It installed no
  pixi, resolved the archive under the pre-Scrollcase stem, promoted a channel
  document from a path the builder no longer writes, and installed a gcloud CLI it
  never calls — which broke self-hosted Windows outright. Validation exercised all of
  this; release had not run since the migration.
- **Generated files were edited instead of their templates.** `scrollcase-consumer`
  was added to `src-tauri/Cargo.toml`, which every `*conf` script regenerates from
  `conf-templates/`, so the dependency vanished at the first real build and took
  `npm run dev` and `npm run build` with it.
- **Three specs each kept a private copy of the same helpers and drifted apart.**
  Two had been unloadable for three weeks. scGPT's covered install plus one
  embedding, which the evidence contract correctly refuses for a Linux publication —
  so a box could be promoted with no record the product could use it.
- **Windows MAX_PATH is a budget, not an edge case.** A box is a packaged conda
  environment: transformers ships a 115-character module path on its own, and the
  app's data directory and staging add 84. Rust extracts through verbatim paths and
  writes those files happily; the box's Python cannot open them. A real install has
  room, with about two characters to spare for a long user name — see the standing
  constraint below.
- **Assertions that name a literal outlive what they name.** A hardcoded CUDA `12.4`
  survived the 12.9/12.8 migration and failed a release after a complete 7.8 GB
  install and a real CUDA inference had already passed.
- **A failure that reports only its shape costs a whole run.** Three separate
  failures — an install error, an install status, a job status — were asserted before
  the app's own account of them was read, on an ephemeral runner that takes the logs
  with it. Every one of them had to be re-run purely to learn the cause.

Last updated: 2026-08-07 (the Runtime Box builder extraction is complete:
Scrollcase is an independent Apache-2.0 project outside this repository.
Liatir now pins exact public `scrollcase@0.8.0` — raised from `0.4.11` to
`0.7.1` on 2026-08-06 and to `0.8.0` on 2026-08-07, see next step 2; the second
raise changes no archive byte, so it costs no rebuild — and P5.2V has completed the
v2-only contract cutover. Scrollcase is not a Liatir workspace, vendored source
tree, or codebase to modify from this repository. Schema v1 is explicitly
unsupported rather than retained as a parallel reader. P5.3 is complete:
all three foundation v2 scrolls/locks/audits passed matching native validation
on macOS, self-hosted Linux and self-hosted Windows, and each old uv fixture was
removed only after its native proof. P5.4 is complete, as one phase with
three operational blocks: scGPT v2, Geneformer CPU/Metal plus UCE, and the
Geneformer CUDA legacy/successor decision. **P5.4V is complete too: every one of
the eleven targets was rebuilt and re-measured on `scrollcase@0.7.1` by
2026-08-07, so every archive SHA-256, archive size and installed size quoted in
the rest of this paragraph is the superseded `0.4.11`-era proof. The current
figures are in next step 2 and in the P5.4V rebuild table.** Block 1 started with
the scGPT Linux CPU input: it is now a single schema-v2 scroll with the existing pixi lock
preserved byte-for-byte and a Scrollcase v2 audit. Its complete native proof
passed in run `30599143569` on self-hosted runner
`liatir-linux-selfhosted-1785464985-360`: archive SHA-256
`1cdaafa35270bf53a6bdc722a7f3d8e0d26fec70f5e359192322a053ff3b5801`,
archive `1212137655` bytes, installed `3544428400` bytes and compact artifact
`8781444892`. Windows CPU is also a single schema-v2 scroll with its exact lock
and 94-package Scrollcase audit, and passed the complete native lifecycle in run
`30707681953` on runner `liatir-windows-selfhosted-1785600732-2300`: archive
SHA-256 `99fce2900499b83a6db83fe3de61403f792adf7cefaad26276b433a50e44f235`,
archive `566942596` bytes, installed `1478447610` bytes and compact artifact
`8821068033`. Linux CUDA 12.9 is likewise canonical v2 with its lock preserved
byte-for-byte and passed native lifecycle run `30709157030` on the RTX 4060 Ti:
archive SHA-256 `006796c1636eead60acaa65b8825054aa005bed96807f0768fcc60f1564135d7`,
archive `17098121591` bytes, installed `27706335619` bytes and compact artifact
`8821789904`. Windows CUDA 12.8 completed the requested Linux/Windows scGPT set
in native lifecycle run `30711089971`: archive SHA-256
`1ad3b68cb526d976ecd280479d053cd6323a1c5ea7af4bfe8aab1b07f6218e39`,
archive `4378954604` bytes, installed `7053500062` bytes and compact artifact
`8822298430`. All four Linux/Windows scGPT targets are now canonical v2 and
natively proven. The macOS Metal authoring input is also canonical v2: its
existing pixi lock remains byte-identical at SHA-256
`04f83b64db8b5f6faf65fa40c677d6596a50c7d5482c51d8c1baa173588b388a`,
published `scrollcase@0.4.11` generated and checked its 100-package audit, and
native CI resolves to the dedicated `liatir-macos-arm64-heavy` self-hosted
runner. First native run `30715635531` at commit `c855e66` passed the clean
build, local signing, archive verification and self-test, then failed closed in
the real scientific forward because the inherited macOS prune list removed
locked `sympy`, which PyTorch 2.8 imports lazily. Rust lifecycle therefore did
not run. Failure artifact `8823318701` is incident provenance, not acceptance
evidence. The Liatir scroll now retains every locked runtime dependency, matching
the other four scGPT v2 targets, and a cross-target regression forbids `venv`
prune paths. The single authorized retry, run `30763954679`, job `91539336858`,
passed clean build, signature and archive verification, scientific Metal parity
and Rust install/activate/rollback/removal lifecycle on runner
`liatir-macos-heavy-1785699749-3285`. Archive SHA-256 is
`d1d39e44a24de0ef4808df27225eb8a9834c0e10d4a40a2171e2c76140231e81`,
archive size is `687615488` bytes, installed size is `1863803480` bytes and
compact artifact `8838446367` preserves the proof. All five scGPT targets are
now canonical v2 and natively proven, so block 1 is complete. P5.4 remains open
at block 2. Its first target, `geneformer-v1-10m-macos-arm64-metal`, is now a
single schema-v2 scroll on pixi 0.73.0 with Python 3.11.15 and PyTorch 2.8.0;
the old schema-v1 uv input and lock are removed. Lock SHA-256 is
`3e9841b2296656458715aa1276ece999b2bdfe4566e8dfdf77c0e29496c4d19f`,
and the matching Scrollcase v2 audit covers 161 conda packages with no PyPI or
source-build escape hatch. Native-lifecycle run `30766478916`, jobs
`91546006154` and `91546052389`, passed from clean commit `6fe5a07` on ephemeral
self-hosted runner `liatir-macos-heavy-1785703738-15134`: frozen build,
signature/archive verification and self-test, real torch 2.8.0 Metal parity,
and Rust install/activate/rollback/removal lifecycle. Installed size is
`2179953895` bytes, archive size is `672331169` bytes and archive SHA-256 is
`3ce6e4baecae7a641da6a6ecd2a71148f3d9c62f44e42fd5baa04a8110b0ae62`.
The finite `[4, 256]` embedding passed at maximum absolute error
`8.121132850646973e-7` and minimum cosine similarity
`0.9999999403953552`. Compact artifact `8839187730` preserves the acceptance
evidence. The runner deregistered and its marked root was removed. The second
block-2 target, `geneformer-v1-10m-linux-x86_64-cpu`, is a single schema-v2
scroll on pixi 0.73.0 with Python 3.11.15 and PyTorch 2.8.0; the legacy uv
descriptor and locks are removed. The committed Linux lock SHA-256 is
`551716a80946450c076c9c0184458b5a29da855117b13a9da98129f4a19e16b4`,
and the matching `scrollcase@0.4.11` conda audit reviews 171 packages with no
unresolved licence. Native-lifecycle run `30872534594`, jobs `91877296883` and
`91877388153`, passed from clean commit `6a26a35` on ephemeral self-hosted
runner `liatir-linux-selfhosted-1785811312-359`: frozen build,
signature/archive verification and self-test, real torch 2.8.0 CPU scientific
validation, and Rust install/activate/rollback/removal lifecycle. Installed size
is `3959042677` bytes, archive size is `1232703132` bytes and archive SHA-256 is
`ead3546f6e39fb5d4e513ad9dbd33374a80e208566eef4e352152180cf320c6e`.
The finite `[4, 256]` embedding passed at maximum absolute error
`8.67992639541626e-7` and minimum cosine similarity `0.9999999403953552`, with
output and provenance contracts green. Peak additional runner disk was
`6244888576` bytes, so the catalog disk plan now carries those measured sizes
inside the retained 12 GiB floor. Compact artifact `8878554308` preserves the
acceptance evidence; the runner deregistered and its marked root was removed.
The third block-2 target, `geneformer-v1-10m-windows-x86_64-cpu`, is also a
single schema-v2 scroll on pixi 0.73.0 with Python 3.11.15 and PyTorch 2.8.0
`cpu_mkl`, resolved only from conda-forge; the legacy uv descriptor and locks
are removed. The committed Windows lock SHA-256 is
`17aaea6dd7c4fdca8d37c6898c82020c210b21458f53d22d03b2f3b3324438ab`,
and the matching `scrollcase@0.4.11` conda audit reviews 150 packages with no
unresolved licence. `pythonEntryPoint` stays `venv/python.exe`, and catalog
identity, asset hashes and the immutable `1.0.0-beta.1` publication metadata
are unchanged. Native-lifecycle run `30915003666`, jobs `92010824861` and
`92011005131`, passed on the first dispatch at clean commit `d337977` on
ephemeral self-hosted runner `liatir-windows-selfhosted-1785850729-16884`:
frozen build, signature/archive verification and self-test, real torch 2.8.0 CPU
scientific validation, and Rust install/activate/rollback/removal lifecycle.
Installed size is `1824134154` bytes, archive size is `493253025` bytes and
archive SHA-256 is
`afc48a00f1f6cfe3b557069c8d77169f95327b257887c50a1c32126eb5a4a684`.
The finite `[4, 256]` embedding passed at maximum absolute error
`4.470348358154297e-7` and minimum cosine similarity `1`, with output and
provenance contracts green. Peak additional runner disk was `3558084608` bytes,
so the catalog disk plan carries those measured sizes inside a reduced 8 GiB
floor. Compact artifact `8895358103` preserves the acceptance evidence; the
runner deregistered and its marked root was removed. All three Geneformer
CPU/Metal targets are now v2 and natively proven. Block 2 closed with UCE on
2026-08-06; see next step 2 for its proof.
**P5.4 block 3 (Geneformer CUDA) is resolved and closed without a successor
(2026-08-04).** Liatir is not released, so neither CUDA 12.4 identity has
installed users, and both `linux-x86_64-cuda12.4` and `windows-x86_64-cuda12.4`
were deleted outright — catalog entries, uv recipes, licence audits, evidence
records, signer-policy entries, release-workflow options, `@liatir/core`
published-target candidates and the legal record's CUDA sections. No frozen
"installable but not buildable" catalog status was needed. No CUDA successor is
introduced for Geneformer: the recorded evidence for the same validator shows
CPU at `11073` ms against CUDA at `15104`/`14573` ms, so at 10M parameters the
GPU never earns back its initialisation cost. CUDA capability is unaffected —
scGPT keeps `linux-x86_64-cuda12.9` and `windows-x86_64-cuda12.8`, both natively
proven. **Residual gap:** those timings come from the pinned 4-cell by 128-gene
fixture, so they measure fixed overhead, not throughput. Before Geneformer is
presented to users as CPU-only, the CPU-gating policy's own realistic-dataset
throughput measurement is required; if it misses the UX threshold, a CUDA
successor is added then, and because both 12.4 identities are gone that addition
is purely additive.
**That successor now exists, and Geneformer Linux CUDA 12.9 is native-lifecycle
proven (2026-08-05).** The `~160` ms per cell CPU measurement missed the UX
threshold, so the no-successor half of the 2026-08-04 decision was reversed as
that decision anticipated: `linux-x86_64-cuda12.9` (`d47f277`) and
`windows-x86_64-cuda12.8` (`53c3a21`) were added as purely additive targets with
fresh identities. Geneformer now has no CPU box at all; these two plus macOS
Metal are the model's entire matrix. Linux passed the complete native lifecycle
in run `31048217909`, preflight job `92448923182` and native job `92449033200`,
on runner `liatir-linux-cuda-selfhosted-1785964781-457` at commit
`53c3a215e0b6aab32965273a1d755b86c0a3a198`, lock SHA-256 `2f2e22e0…5ae4`
unchanged. The RTX 4060 Ti build (cc `8.9`, driver `610.62`, CUDA `12.9`, pixi
`0.73.0`, Python `3.11.15`) produced archive SHA-256
`2065bf14c7c6e0121ae1806716558d42e6c7137b307acbfca75386f18ac66819`, archive
`17118987830` bytes, installed `28120935919` bytes. Parity against the same-lock
CPU baseline passed at minimum cosine `0.9999999403953552` and maximum absolute
difference `6.593763828277588e-7`, peak VRAM `106767872` bytes. Compact artifact
`8948374199`, preflight artifact `8947316103`. **The authored disk plan was
wrong and is now measured** (`9063053`): estimates of `12000000000`/`5000000000`
against real `28120935919`/`17118987830`, so the calculated peak rose to
`48504658717` and the `25769803776` floor could not stand — the build consumed
`45849923584` additional bytes. The floor is now `60129542144`, matching scGPT's
Linux CUDA 12.9 target under the same `68719476736` bootstrap requirement. The
`16863` ms scientific figure is still the 4-cell fixture and does not re-open
the throughput comparison.
**Windows CUDA 12.8 followed and Geneformer's matrix is now complete
(2026-08-05).** Its Linux-first gate reads the Linux target's catalog `status`
rather than any run result, so recording Linux as `native-lifecycle-validated` —
the status the run earned, carried by all four proven scGPT targets with no
`publication` object — is what opened it (`5960026`). Windows then passed the
complete native lifecycle in run `31057320891`, preflight job `92477540997` and
native job `92477608909`, on runner
`liatir-windows-cuda-selfhosted-1785973279-480` at commit
`5960026f93a65d59a493942d46a620fd48920dd9`, lock `ce2e51ed…b5ec` unchanged. The
backend resolved to `transformers-4.44.2-cu128`, confirming win-64 has no 12.9
build. Archive SHA-256
`cee651ca0b30f4d6a9b7329dbddc247412c98db199ba3ef0d63a7d86ade2e0c2`, archive
`4304659539` bytes, installed `7398569837` bytes, parity at minimum cosine `1`
and maximum absolute difference `1.4901161193847656e-6`, peak VRAM `106767872`
bytes — the same VRAM as Linux. Compact artifact `8951371593`, preflight artifact
`8950746395`. Its measured plan of `14967964344` fits the retained
`25769803776` floor, because the win-64 conda CUDA substrate is about a quarter
the size of the linux-64 one; that asymmetry is why each target's plan had to be
measured rather than shared. Both CUDA targets are `native-lifecycle-validated`
and **unpublished** — no signature, publication, channel promotion or release for
either, and `published` is still held only by `macos-aarch64-metal`. Both
ephemeral runners deregistered and both marked roots were removed.
**The published beta objects are schema v1, and the current app rejects them
(2026-08-05).** Attempting to close that throughput measurement established a
larger fact: no published AI Model Runtime Box can be installed by the current
app. The beta channel serves schema-v1 signed documents for all three Geneformer
targets — `linux-x86_64-cpu`, `windows-x86_64-cpu` and `macos-aarch64-metal` —
while `RUNTIME_BOX_SCHEMA_VERSION` is `2`. The install fails at the first step,
on the channel document, in `verify_signed_payload`
(`src-tauri/src/bridge/runtime_boxes.rs`), with `unsupported signed Runtime Box
document`; the release-manifest and identity checks never run. The same rejection
reproduces independently through the v2 verifier the app delegates to after
P5.4R: `scrollcase@0.4.11` `decodeSignedDocument` raises `Unsupported
schemaVersion 1; rebuild this box with Scrollcase v2.` The published bytes
themselves are intact — the downloaded Linux CPU archive hashes to
`a95a1a403bff74cf2af6c1b3f96cecace1201364ff94eec621ca90b80bf5a95b`, matching both
the signed release and the catalog pin — so this is a document-schema rejection,
not corruption. `scgpt-whole-human` `linux-x86_64-cpu` is not on the beta channel
at all (`404`), and the v2 Linux Geneformer archive `ead3546f…` from
native-lifecycle run `30872534594` is absent from the asset bucket (`404`).
Root cause: the v2 pixi rebuilds were natively validated but never re-released,
so beta still serves the uv-era objects published on 2026-07-17.
`runtime-boxes/catalog.json` carries that split inside a single target:
`dependencyLockSha256` `551716a80946450c076c9c0184458b5a29da855117b13a9da98129f4a19e16b4`
and `diskPlan.estimatedInstalledSizeBytes` `3959042677` are v2 pixi, while
`publication.archiveSha256` `a95a1a40…` and `publication.installedSizeBytes`
`1211538007` are v1 uv. The tracked evidence record
`runtime-boxes/evidence/geneformer-v1-10m-linux-x86_64-cpu-1.0.0-beta.1.json`
(created `2026-07-17T01:46:51Z`, Python 3.11.9, uv 0.11.28) records
`productLifecycle.assertions.install: passed` for the **uv** box against the app
of that date — so it must not be read as evidence that the current app installs
anything from beta. No such evidence exists for any target.
This is not a new decision: the migration plan already ends every target with
"protected release (KMS sign, R2 publish, beta) → flip to `published`". What is
new is the consequence of the gap between validation and release — the published
catalog is currently uninstallable, and any user-facing install or CPU-only claim
is unsupportable until each target is re-released. No signing, publication or
promotion was performed while establishing this.
**P5.4R first slice is complete (2026-08-04).** `src-tauri` pins exact
`scrollcase-consumer` — `=0.1.2` then, raised to `=0.2.0` by P5.4T and `=0.3.0` by P5.4E —
and `runtime_boxes.rs` now delegates signed
document verification, trust-key parsing, target identity and the safe-path rule
to the crate; `RuntimeBoxTarget` is a type alias for the crate's `BoxTarget`, so
unknown fields are now rejected instead of silently discarded. Signature
verification also strengthens to `verify_strict`. Schema-version detection stays
Liatir's, from the parsed integer before the crate is called, so the
unsupported-format state never depends on an upstream error string. The
**P5.4R second slice is also complete:** extraction now goes through
`archive::extract_zip_archive`, so encrypted entries, special entries, entry
collisions, links leaving the payload and entries written through a link are
refused at the Runtime Box boundary instead of in a helper shared with managed
binaries. `runtime-box:test:native` passed end to end on the new path and
reproduced `installedSizeBytes` `257776217` exactly against the pre-change
baseline. Zip64 is proven through Scrollcase, which matters because the largest
published box is a 17 GB CUDA archive. One behavioural change: a declared-size
mismatch is now caught after extraction by `dir_size` rather than before writing
anything. `verify_and_extract_box` and `attach_extracted_box` were
not adopted — they took a trust-key *file* path, while Liatir compiles its trust
anchors into the binary so a user-editable key cannot defeat signing. That
objection is resolved upstream by P5.4T, but adoption is still blocked by the
release-schema divergence measured below, which is the real gate. Still
open: `verify_extracted_payload` needs a `payloadDigest`, which only `0.7.0`
builds emit, so it belongs to P5.4V. Note the accepted cost: the crate's `zip 8` / `ed25519-dalek 3` / `sha2 0.11` / `base64
0.23` majors coexist with Liatir's own `zip 2` / `ed25519-dalek 2` / `sha2 0.10`
/ `base64 0.22`, which stay because `lia_plugins`, `quenta`, `snpeff`,
`diagnostics` and `managed_bins` still use them.
**P5.4T is complete (2026-08-06).** The pin is exact `scrollcase-consumer =
"=0.2.0"` at the time, since raised to `=0.3.0` by P5.4E. Its breaking change — every entry point takes `TrustAnchors` instead of
a `public_key_path` — cost Liatir nothing, because the bridge never used a
path-taking entry point and already passed compiled-in keys to
`verify_signed_document`, whose signature is unchanged. The gain is
`trust::parse_trusted_keys`, which replaces the `TrustedKeyBundle` /
`TrustedKeyDocument` pair Liatir had hand-written over the same trust-file format.
That also removed a real inconsistency: `LIATIR_RUNTIME_BOX_TRUSTED_KEYS_JSON` used
to deserialise a *bare array*, so the compile-time trust source disagreed with the
file sources about what a valid trust document looks like. All three now read the
single-key-or-bundle shapes identically. `runtime-boxes/README.md` documents the
accepted shapes and the reason to prefer the bundle. No box format, signature or
published artefact changed; 39/39 Rust tests and `test:verify` green.

**Only `compatibility` diverges from the box format; everything else now delegates
(2026-08-06).** All five entry points — `verify_and_extract_box`,
`attach_extracted_box`, `verify_extracted_payload`, `inspect_box_archive`,
`run_box` — funnel through `inspect_release_document`, which parses the release
with Scrollcase's own `release::ReleaseManifest`. That type is
`deny_unknown_fields`, and its compatibility block was neutralised during
extraction to `minHostAppVersion` / `maxHostAppVersionExclusive`, while every
Liatir scroll, fixture and *published, signed* release still carries
`minLiatirVersion` / `maxLiatirVersionExclusive`. Measured directly against
`runtime-boxes/contract-compatibility-fixtures.json`:

> `unknown field 'maxLiatirVersionExclusive', expected one of 'minHostAppVersion',
> 'maxHostAppVersionExclusive', 'minMacosVersion', 'minRamGb',
> 'minNvidiaDriverVersion', 'hostEnvironments'`

Renaming the fields on the Liatir side is not available: the compatibility block
sits *inside the signed payload*, so it would invalidate every published box and
force a re-sign and re-publish of the whole catalog — a breaking change to box
identity, not cleanup.

**P5.4E is resolved upstream and adopted; Liatir no longer owns a release type
(2026-08-07).** `minLiatirVersion` was never a Liatir deviation: Scrollcase's own
schema sets `additionalProperties: true` on `compatibility` and states the
builder "copies these constraints through verbatim and never interprets them, so
a project may add its own alongside the ones defined here". The Rust
`Compatibility` was nevertheless `deny_unknown_fields` — stricter than the schema
the crate itself ships. The two consumers were measured disagreeing about the
same bytes: `runtime-boxes/contract-compatibility-fixtures.json` validated
**ACCEPTED** through the Node consumer's own schema validation while the Rust
type rejected it. An intermediate revision of this file argued the refusal was
intentional, reading "a consumer that cannot evaluate a constraint must refuse
the box" as authority; that was wrong, and the disagreement between the two
consumers is what settled it. The sentence governs *evaluation*, not parsing.

`scrollcase-consumer 0.3.0` fixes it: `Compatibility::additional` carries the
constraints the format does not define, and the crate states that an application
finding one it does not understand must refuse the box. Liatir pins `=0.3.0` and
has **deleted `ReleaseManifest` and `RuntimeBoxCompatibility` outright** — the
release type is now the box format's own, `to_box_format` is gone, and
`assert_box_manifest_agreement` is called directly. Verified by parsing a real
Liatir release through Scrollcase's type: accepted, with
`{minLiatirVersion, maxLiatirVersionExclusive}` landing in `additional`.

Evaluating those two is now explicitly Liatir's half of the contract, in
`check_compatibility`, which also **refuses any constraint it does not
recognise** rather than skipping it — skipping one would install a box on a host
the publisher had excluded. A constraint present but not a string is treated as
malformed, not absent, for the same reason, and a release naming no minimum at
all is rejected as never having been through Liatir's publishing path. All three
cases carry regression coverage.

**Everything except `compatibility` now delegates (P5.4T, second slice).** The
divergence turned out to be exactly one block: `provenance` in Liatir's real
documents already matches Scrollcase's `Provenance` field for field, and so do
`archive`, `selfTest`, `assets` and `execution`. So Liatir's `ReleaseManifest` now
holds the box format's own types, and `RuntimeBoxArchive`, `RuntimeBoxSelfTest`
and `ExtractedBoxMetadata` are deleted. `validate_extracted_box` no longer
restates which fields must agree: it parses `box.json` as `BoxManifest` and calls
`assert_box_manifest_agreement`, bridging the one divergent block through
`ReleaseManifest::to_box_format`. That conversion mirrors a pattern the shared TS
contract already established — `LiatirRuntimeBoxCompatibility` is literally
`Omit<BoxReleaseManifest["compatibility"], "minHostAppVersion" | …> & {
minLiatirVersion … }` — so the two sides now translate the same way.

Three things came out of it. The hand-written comparison was checking 13 fields
where the format has 14: `environment` was never compared, so a signed
environment map could have differed from the archive's copy unnoticed. No box
carries one today, so it was latent, and it is now closed. Errors now name the
field that differed instead of saying only "does not match". And `min_ram_gb`
becomes `f64`: TypeScript already derived it from Scrollcase's type, so `u64` was
the outlier — Rust was the only side that could not express a fractional
requirement. Conversion rounds *up*, or a host short of the requirement would
satisfy it by truncation; NaN and infinity are rejected rather than compared.
`dir_size` is now `filesystem::payload_size`, which matters beyond DRY: the
*builder* sizes the payload with that rule when it writes `installedSizeBytes`, so
a second implementation here is how the two come to disagree and fail an honest
box. Not adopted: `filesystem::validate_extracted_tree` (Liatir has no
equivalent, so it would be a new rejection path, and no real box was available to
prove it accepts the current catalog) and `filesystem::sha256_file` (Liatir's
hasher is shared with plugins and managed binaries; swapping only this call site
would leave two hashers in the app). 41/41 Rust tests, including new coverage for
the agreement delegation and for fractional memory requirements.

No signing, publication or promotion occurred. Published
scGPT `0.2.5-beta.1` and Geneformer `1.0.0-beta.1` objects remain immutable. The
full CI substrate migration to pixi + pixi-pack +
conda-forge on self-hosted GitHub Actions runners has been planned and approved
in principle — see the migration plan below. Its **Phase 0 relocation/activation
spike is now complete and decisive on ALL THREE OSes: macOS Metal, Windows
(CPU + CUDA) and Linux (CPU + CUDA)**: conda-pack is the chosen relocation
mechanism and **no activation environment is required on any OS** — a relocated
conda-forge prefix imports the whole scGPT set cold and runs accelerator compute
(Metal on macOS, a real CUDA matmul on the RTX 4060 Ti on both Windows and Linux)
under a fully empty environment, so the Rust self-test/run path stays
activation-free everywhere and the manifest `activation` field stays `null` for
every target. Two recipe corrections, and the CUDA pin is **per-OS**: conda-forge's
CUDA `pytorch 2.8.0` is **cuda128** for win-64 but **cuda129** for linux-64, so
Windows CUDA pins **12.8** and Linux CUDA pins **12.9** (neither has a 12.4 build,
and 12.8 does not solve at all on linux-64). See
[Phase 0 decision record](../decisions/runtime-box-pixi-phase0-spike.md).
**Phases 1 and 2 of that migration are also complete**: the scGPT macOS pilot is a
pure pixi recipe that builds end-to-end into a signed box whose self-test passes on
torch 2.8.0, and the Rust layer needed no change at all. **Phase 3 is complete for
Linux and Windows**: a cross-OS ephemeral runner launcher (macOS + Linux/WSL) plus a
Windows PowerShell counterpart, four self-hosted runner profiles, every Linux and
Windows model target repointed onto them, and the paid `liatir-linux-t4` /
`liatir-windows-t4` profiles deleted. All four self-hosted preflights pass against
the real GitHub API; only coordination jobs stay on cheap hosted runners, by design,
because the resolve job is what tells the operator which runner to start. Native jobs
queue until the operator brings the matching runner online — the established Gate 9
on-demand model — and **many self-hosted validation runs have since executed** (the
scGPT results below).
**Phase 4 is also complete**: GPU runner profiles now declare capability and VRAM
**floors** (compute ≥ 7.5, ≥ 7.5 GB) instead of pinning one exact card, and the
parity validator, host probe, evidence record and CUDA E2E no longer hard-code a
Tesla T4 — so the local RTX 4060 Ti is accepted. CUDA has since been **exercised for
real on the 4060 Ti** (the scGPT CUDA runs below). The old 15 GB VRAM floor had
no scientific basis: the reviewed CUDA run measured a peak of ~102 MiB. **Phase 5 is
in progress**: scGPT `linux-x86_64-cpu` is migrated off uv onto pixi, and
`windows-x86_64-cpu` is added as a new target that never had a uv recipe — both with
committed `pixi.lock` files, lock-derived conda licence audits (112 and 94 packages,
all licensed), measured `diskPlan` floors, and wiring into the catalog, signer policy
and workflow. They started `buildable`; their current validated statuses are below, and
**nothing has been signed, published or promoted**. **scGPT Linux CPU is now scientifically validated natively on the self-hosted
runner** — the first pixi box built and validated in CI (run `30132956412`, mode
`scientific`, ~9.5 min on an ephemeral WSL runner): pixi 0.73.0, torch 2.8.0 CPU,
a finite `1 x 512` embedding, self-test and output/provenance contracts all passed,
measured installed 3.55 GB / archive 1.21 GB within the diskPlan floors. **scGPT
Windows CPU is likewise scientifically validated natively** on the self-hosted Windows
runner (run `30134159371`, torch 2.8.0 CPU, finite `1 x 512`, installed 1.39 GB /
archive 0.53 GB). **scGPT Linux CPU has also passed `native-lifecycle` on CI** (run
`30135717742`: Tauri built with Rust 1.95 and the `cargo test runtime_box` suite run
against the pixi box), advancing to `native-lifecycle-validated`; this needed a scoped
passwordless `apt-get` on the WSL runner (`/etc/sudoers.d/liatir-runner`). scGPT
Windows CPU `native-lifecycle` also passed (run `30136322406`; no sudo needed, VC++
tools already present), so **both scGPT CPU targets are now fully validated in CI at
build, scientific and native-lifecycle** and sit at `native-lifecycle-validated`. **The macOS
shared-launcher re-check is now DONE** (2026-07-25, local zero-cost on the maintainer's
Apple-Silicon Mac): the cross-OS launcher's Darwin branch passed `--preflight-only`
(`Self-hosted runner preflight passed for liatir-macos-arm64-heavy with 45410160640
free bytes`, exit 0, registered nothing, inventory stayed empty), exercising the
`Darwin:arm64` host detection, `shasum -a 256` path, catalog resolve, host/target guard
and disk floor. The optional native pixi box build was also run: scGPT
`0.2.5-beta.1` macos-aarch64-metal built and signed on the pixi substrate, and
`verify --self-test` passed (`Verified scgpt-whole-human 0.2.5-beta.1
(macos-aarch64-metal)`), loading `best_model.pt` on torch 2.8.0 Metal — measured
archive 655,752,216 B (≈0.61 GB); build/dist cleaned up afterwards.
**scGPT Linux CUDA 12.9 is now scientifically validated on the RTX 4060 Ti** —
the first CUDA box on the pixi substrate and the first CUDA validation on the
local GPU (run `30141976372`): pytorch 2.8.0 cuda129, CPU-vs-CUDA parity passed
(cosine 0.99999999999994), peak VRAM ~209 MiB, GPU identity matching the host.
This proves the Phase 4 hardware generalization end to end. **scGPT Windows CUDA
12.8 is likewise validated on the 4060 Ti** (run `30143289750`, parity cosine
0.9999999999999, box installed 6.58 GB / archive 4.08 GB — much smaller than
Linux CUDA, which inflates from symlink dereference that Windows does not do); it
passed on the first dispatch by applying the Linux CUDA lessons up front. **scGPT
is now natively proven on all five targets**, including the macOS Metal v2
rebuild. The Linux CUDA run took five dispatches,
each a distinct defect in the new CUDA path or the WSL host (CPU-cloned self-test,
/tmp tmpfs too small for verify, a dropped checkpoint download, missing
GPU-identity evidence), never the box or the CUDA compute itself; those fixes are
permanent. Geneformer macOS Metal, Linux CPU and Windows CPU are also complete
on v2.
Remaining Phase 5: complete the later Geneformer and UCE targets. After that,
only the
protected release remains per target, gated on the maintainer's go-ahead and a
prior signer deploy.

Before any protected release the signer must be deployed, because the
previous failure was deployed-policy drift, not a build defect. **That drift
is now caught automatically**: the signer exposes a policy fingerprint on
`/health`, and the release workflow fails fast (right after GCP auth, before
the paid build) if the deployed policy does not match the committed one,
pointing the operator at `runtime-box:signer:deploy`. It deliberately does
not auto-deploy — that would hand the release job the signer's admin rights.
Production code has therefore already changed under this migration. Runtime Box CI foundation Gates 0–10 are
complete; the product AI Model catalog has been cut over to Runtime Box-only
delivery).

This file is the quick handoff snapshot. The canonical detailed plans are:

- [Scientific AI Workbench product plan](./roadmap/scientific-ai-workbench.md) —
  the overall product direction and phase gates.
- [Runtime Box cross-platform CI foundation](./roadmap/runtime-box-ci-foundation.md) —
  the completed foundation gate ledger. Read it before touching Runtime Box CI;
  it holds the authoritative status table, execution records, and incident
  ledger.
- [Runtime Box production report](../history/runtime-box-production-report.md) —
  the current support matrix, production topology, reviewed evidence, protected
  identities, and operator handoff.
- [Runtime Box model platform expansion](../history/runtime-box-model-platform-expansion.md) —
  the historical pre-pixi execution ledger for scGPT/UCE portability and early
  protected-release defects. Its evidence remains useful, but its target table
  and dispatch instructions are superseded by the pixi migration and Scrollcase
  P5 plan.
- [Runtime Box pixi migration](../history/runtime-box-pixi-migration.md) — the
  active Liatir recipe/runner/scientific migration onto the independent
  Scrollcase pixi + conda-pack + conda-forge builder (Variant A + a contained
  PyPI escape hatch), using self-hosted GitHub Actions runners and torch 2.8.0.
  **Phases 0–4 complete; Phase 5 in progress** — all five scGPT targets plus
  Geneformer macOS Metal, Linux CPU and Windows CPU have complete native v2
  proof, including
  real CUDA on the self-hosted RTX 4060 Ti. Remaining Phase 5: complete later
  Geneformer and UCE targets, then the protected releases. The uv path is
  retained only for not-yet-migrated recipes.
- [Runtime Box pixi Phase 0 spike](../decisions/runtime-box-pixi-phase0-spike.md) —
  the decisive local relocation/activation decision record: conda-pack, **no
  activation env on any OS (macOS, Windows and Linux, CPU + CUDA)**, `venv`
  box layout, footprints ≈833 MB (macOS) / ≈1.35 GB (win CPU) / ≈6.5 GB (win CUDA)
  / ≈1.63 GB (linux CPU) / **≈9.5 GB (linux CUDA, the largest box in the matrix)**,
  CUDA pinned per-OS at 12.8 (win-64) and 12.9 (linux-64). The Linux CUDA proof ran
  under WSL2's driver bridge, so it is strong evidence rather than bare metal;
  cuDNN/cuBLAS/libtorch_cuda were all verified to load from the relocated prefix.
- [scrollcase extraction plan](../history/scrollcase-extraction-plan.md) — the
  extraction of the Runtime Box **builder** into an independent Apache-2.0
  open-source tool named Scrollcase. **Extraction phases P1–P4 are complete
  (2026-07-26):** the canonical source is now the standalone public repository
  `https://github.com/suffro/scrollcase`, documentation is live at
  `https://scrollcase.dev`, and Liatir now consumes exact public
  `scrollcase@0.8.0` (`0.4.11` until 2026-08-06, `0.7.1` until 2026-08-07). The `0.1.0`–`0.1.3` releases remain historical extraction
  milestones: `0.1.1` added public TypeScript declarations, `0.1.2` added
  browser-safe contract helpers, and `0.1.3` safely handled conda symlink chains
  while removing machine-specific conda metadata. The temporary
  in-tree copy was removed from Liatir in `6b4934e`.
  Scrollcase is a pixi + conda-pack + conda-forge CLI and library with seven verbs
  (`init`, `doctor`, `keygen`, `lock`, `audit`, `build`, `verify`), deterministic
  signed boxes, generated schema-derived contract types, licence audit,
  embed/on-demand weights, declared accelerator parity, and local or external
  signing. Its managed per-project toolchain bootstrap requires explicit consent
  and verifies the downloaded pixi archive; the shared `--global` toolchain is
  deliberately outside the current package. The `0.1.2` standalone release gate
  passes 113 tests across 11 files, generated-declaration checks, the docs build,
  tarball inspection, and a browser bundle. The original extraction CI run
  `30209373381` passed all 11 Node 20/22/24 jobs across Linux, macOS and Windows
  plus package/audit/docs gates.
  **The schema-v1 P5.0–P5.2 record is historical. P5.2V is complete on exact
  `scrollcase@0.4.11`; P5.3 is complete on macOS, Linux and Windows native
  evidence.**
  `@liatir/core` consumes/refines the published
  generic contract. The active adapter routes doctor/keygen/verify and pixi
  lock/audit/build through exact installed `scrollcase@0.8.0`, forces the existing namespace,
  supplies the private Cloud Run signer through Scrollcase's external-command
  boundary, and keeps CI/evidence/distribution in Liatir. That is consumer-side
  integration only: no Scrollcase source is present or modified here.
  The workflow widening was removed and foundation native fixtures are now
  manual-only; heavy model-native jobs remain explicit and self-hosted. The
  independent `0.1.3` fix was consumed only through its published package.
  The v2 stdlib fixture completed real key generation, unchanged committed lock
  resolution, two deterministic builds, conda-pack, stdlib self-test, a signed
  `liatir.runtime-box.release`, separate `verify --self-test`, Node consumer
  execution and Rust activation/rollback/removal plus v1 rejection. The macOS
  foundation uv recipe was removed only after that native proof. Linux run
  `30594110843` passed on
  `3de11868c510665544d54f9251496c479d02866a` with archive SHA-256
  `4968084661a0fc98b36dd2e86f37e5642ba092afd8078459e7a7a1ae5fc94fca`,
  archive size `200216832` bytes and installed size `506827820` bytes.
  Windows run `30595863980` passed on
  `1dc25fd25d299f970fbc0501197267e03ec50d16` with archive SHA-256
  `e0455e6de2fa86b18ae47581e2cb47048520b114d7f003141fef1d5a8561c4bc`,
  archive size `44718074` bytes and installed size `126224685` bytes. Both
  matching uv fixture directories were removed only after those proofs.
  Failed precursor runs `30565143883` (missing generated bridge ordering) and
  `30594990987` (Windows symlink privilege in the TAR rejection fixture) remain
  incident provenance, not acceptance evidence; cancelled old run
  `30548041903` is also not valid evidence. Public
  `scrollcase@0.4.11`, inspected
  from its npm tarball on 2026-07-30, requires schema v2 and a nested
  `scrolls/<boxId>/<targetId>/scroll.json` authoring layout. The canonical P5 plan
  now requires Liatir to replace the active contract completely with v2, reject
  v1 explicitly, provide bounded cleanup for already installed v1 state while
  preserving Results/provenance, then migrate those recipes and delete the
  superseded local generic builder copies.
  The remaining Geneformer and UCE targets still require pixi recipes before
  Scrollcase can build them.
  Liatir continues to own Runtime Box distribution and product concerns: CI/runner
  policy, scientific validation, R2/Registry publication, KMS custody, trust roots,
  Rust/Tauri installation, Jobs, Results and provenance.
- [Scrollcase P5 — Liatir adoption](../history/scrollcase-p5-liatir-adoption.md) —
  the detailed implementation plan for consuming the published package, inverting
  the generic contract, adding the Liatir signer/evidence/distribution adapter,
  migrating the remaining uv model recipes, preserving legacy CUDA target identity,
  and retiring the local generic builder. Status: **the v1 P5.0–P5.2 baseline is
  historical; P5.2V completed on exact `scrollcase@0.4.11`, and P5.3 is
  complete on macOS, Linux and Windows; P5.4 is complete, with all five scGPT
  targets, Geneformer's whole matrix — macOS Metal and both CUDA successors,
  its CPU targets having been dropped on measurement — and UCE migrated and
  natively proven; P5.4V rebuilt all eleven targets on `0.7.1`, and P5.4W raised
  the pin to `0.8.0` without invalidating one of them**. It consumes generic
  types and browser-safe helpers, preserves `liatir.runtime-box.*`, and passes
  the complete `test:verify` gate with 225 unit/contract tests. The stable CLI is
  locally implemented as a thin adapter; pixi operations use the installed
  external tool, and distribution remains Liatir-owned. No uv authoring path
  remains. Core, frontend, signer, Registry and Rust/Tauri now use the
  published-v2 contract, active v1 parsing is removed, and installed v1 state
  has explicit unsupported/removal behavior without rewriting historical signed
  boxes. The foundation workflow is manual, selects one fixture per dispatch,
  runs all checks on the selected ephemeral self-hosted Linux/Windows runner,
  and has no GitHub-hosted preflight. No trust root, published box, remote
  runner, publication, promotion or deployment changed at this checkpoint.

## Where the project is

Phase 1 of the Scientific AI Workbench plan is complete: the Runtime Box CI
foundation has closed Gates 0 through 10. Product-level Runtime Box work now
has two explicit tracks: finish Linux x86_64 and Windows native evidence for the
implemented anti-replay/update lifecycle, and maintain cross-platform parity of
the current model catalog before new model families are admitted. The common
execution spine follows in Phase 2.
The cross-platform track now has a canonical target-by-target execution plan.
(This section from `29951xxxxx` onward is the pre-pixi uv-era narrative, kept as
history; the pixi migration has since superseded these target states — see the top
of this file and the pixi migration plan for current statuses.)
The new scGPT Linux CPU target is checked and deliberately remains `buildable`.
Run `29951014606` exposed and closed a dependency-audit/pruning contradiction.
Run `29951632568` then passed build, self-test, and real finite 512-dimensional
CPU inference, but exposed a shared validation-workflow omission of the Linux
Tauri system libraries at the Rust lifecycle stage. Run `29952407546` proved
that shared fix by compiling Tauri and again passing the native build and
scientific chain, then exposed nondeterministic rollback pruning when Linux
filesystem timestamps tied. The product fix now preserves the exact backup
created by the current activation; its direct regression, all 11 Runtime Box
Rust tests, catalog/signer/docs, and the complete 157-test verify chain pass
locally. Validation run `29954604079` then passed the complete corrected Linux
lifecycle, including a second real finite `1 x 512` CPU inference and every
Runtime Box Rust test; artifact `8543832402` was reviewed.
Protected release `29955615971` passed input resolution, host capacity, OIDC,
toolchain, and the clean-revision boundary, but failed in the private-KMS
signing build before scientific validation, R2 publication, product lifecycle,
or beta promotion. Cleanup passed. **Diagnosed 2026-07-24: it was not a build
defect but deployed-signer policy drift.** The signer returned
`signing_rejected / "target is not approved for this box"`. The repository policy
already listed `scgpt-whole-human → linux-x86_64-cpu` (added by `b3a9a1f`, an
ancestor of the released commit), but committing `policy.json` does not deploy it,
and `runtime-box:signer:deploy` had never been run — so the live Cloud Run
revision served an older policy. The fix is a signer deploy before the retry; no
builder change is needed. The drift check is now automated (the release fails fast
if the deployed signer policy is stale — see the pixi migration plan). **Superseded:**
this uv-era Linux CPU target has since been migrated to pixi and, on that substrate,
validated at build + scientific + native-lifecycle; the uv release above was never
retried.

**Runtime Box-only product cutover (2026-07-22):** the AI Model catalog now
contains exactly Geneformer V1 10M, scGPT Whole-human, and UCE 4-layer. Every
entry is installed only from a signed, published Runtime Box. The former
`builtin`, `managed-download`, and locally built `managed-runtime` AI Model
paths, their preloaders, the mock model/tool, and model-specific Tools for the
removed experimental models have been deleted. The remaining product AI Tool
is Single-cell Embedding, shared by all three published models. Generic managed
binary and Python-environment infrastructure remains only where it is still
used by Native Tools, viewers, Plugins, or Runtime Box execution.

**Cross-platform product policy (2026-07-22):** every AI Model must ultimately
ship on every native product target where its license, framework, and hardware
requirements make execution reasonably possible. A missing recipe or unstarted
validation is support debt, not an exception. Genuine exceptions require an
evidenced upstream or infrastructure blocker and honest compatibility messaging.
Under this rule Geneformer has completed the current macOS Metal, Linux
CPU/CUDA, and Windows CPU matrix; scGPT and UCE are useful pre-release catalog
entries but are not cross-platform complete. Their Linux CPU/CUDA and Windows
CPU Runtime Boxes must be built, published, and product-validated. Windows CUDA
remains a shared infrastructure blocker under the existing no-dispatch decision,
not a claim that the models themselves can never support it.

**CPU support gating (2026-07-23):** CPU support for an AI Model is not
mandatory. Target users are non-technical analysts working on adequate hardware;
adapting a model to inadequate hardware is out of scope, and every supported Mac
has Metal. A CPU Runtime Box is shipped only when the model completes a
realistic reference dataset within an acceptable wall-clock threshold. When CPU
execution would take hours, or is otherwise too slow to be useful, the CPU box
is not shipped for that model and the product states honestly that the model
requires GPU or Metal. This decision is made per model from a measured amortized
throughput, not from the binary fact that inference runs at all. Geneformer V1
10M remains CPU-supported because it is trivially fast on CPU. This refines the
"reasonably possible" clause above: a technically working but hours-slow CPU box
is a false promise for non-technical users, so it does not count as reasonable
support. The scGPT and UCE CPU targets are therefore gated on a local,
zero-cost CPU-vs-Metal throughput measurement before their CPU boxes are built
or published.

Runtime Box CI foundation gate summary (see the ledger for evidence IDs):

- Gates 0–7 and Gate 8.1 (Geneformer Linux CPU + CUDA pilot): **complete**.
- **Gate 8.2 Windows CPU: complete.** Release run `29706828552` (commit
  `f067482`) passed the full protected release on `windows-x86_64-cpu`: signed
  build, native self-test, scientific validation, immutable publication with
  public hash verification, the complete product lifecycle E2E (install,
  interrupted-download resume, real Geneformer inference with a finite 256-dim
  CPU embedding, Jobs/Results/provenance, replacement, rollback, cleanup), and
  beta promotion. The `beta` channel now serves the Windows CPU box.
- **Linux CUDA re-validated on the current code (2026-07-20).** Release run
  `29750614689` (commit `2307663`) passed the full protected release on
  `linux-x86_64-cuda12.4` on `liatir-linux-t4`: signed build, native self-test,
  T4 scientific validation, immutable publication, complete product lifecycle
  (real Geneformer inference on the T4, Jobs/Results/provenance, replacement,
  rollback, cleanup), and beta promotion. This confirms the shared fixes
  (client-side E2E navigation + reactive finalization `$effect`) do not regress
  Linux, and provides fresh Linux CUDA evidence. One run, ~$1.
- **Gate 8.2 Windows CUDA: implementation retained, but deferred and formally
  out of Gate 8 scope (2026-07-21).** Added `runtime-boxes/recipes/geneformer-v1-10m-windows-x86_64-cuda12.4`
  (recipe.json + requirements.in + hash-pinned `requirements.lock` cross-resolved
  with uv 0.11.28 for `x86_64-pc-windows-msvc` + `--torch-backend cu124`), the
  reviewed license audit `runtime-boxes/legal/audits/geneformer-v1-10m-windows-x86_64-cuda12.4.json`,
  the catalog target (status `buildable`, runner `windows-x64-t4`,
  `linuxValidationPrerequisiteTargetId: linux-x86_64-cuda12.4`), the signer-policy
  target, and the release-workflow `target_id` option. The Windows cu124 lock is
  the Windows CPU lock with only torch (cpu→cu124), filelock and regex bumped —
  **no triton, no nvidia-\*** (Windows torch bundles the CUDA runtime), so the
  legal notices are unchanged from CPU. Cheap gates all pass: `runtime-box:ci
  check`, target resolve (peak disk ~15 GB < 20 GB required), LF line endings,
  74 runtime-box unit tests, 11 signer-policy tests. These checks establish only
  that the recipe and orchestration are buildable; they do not establish native
  CUDA support, publication, or a pending release entitlement.
  - Two nvidia-smi quirks were fixed at the cheap host-probe (both in
    `evidence.mjs` `gpuIdentity`, commit `a9af8c6`): nvidia-smi not on PATH
    (now probes System32 + the legacy NVSMI folder) and the unsupported
    `compute_cap` query field (now derives compute capability from the known
    Tesla T4 model; torch scientific validation stays authoritative).
  - **DECISION (2026-07-21): Windows CUDA is deliberately excluded from the CI
    until GitHub ships a newer Windows GPU-runner driver.** Hard blocker: the
    GitHub-hosted Windows T4 runner has NVIDIA driver 471.11 (R470), too old for
    CUDA 12.4 (needs R525+ / R551.61). The host-probe correctly rejected it
    (`driver 471.11 is below 551.61`) in ~1 min before any paid build — infra
    limitation, not code. The recipe + wiring are correct and stay committed
    (target status `buildable`, never `published`), so no unvalidated box ships.
    Do NOT dispatch Windows CUDA release runs until the runner has R525+ (or a
    self-hosted one is added), or a separate `windows-x86_64-cuda11.8` target is
    chosen. The maintainer will separately validate Windows CUDA locally later on
    an RTX 4060 Ti (compute 8.9) — which needs the Tesla-T4-pinned validator
    (`scripts/ai-validation/geneformer-parity.py`) generalized first. Gate 8.2 is
    otherwise closed: macOS, Linux CPU/CUDA, Windows CPU are all validated and
    beta-promoted.
- **Gate 8.2 is closed** on every in-scope target (macOS arm64 Metal, Linux CPU,
  Linux CUDA, Windows CPU). Per the 2026-07-21 re-scope recorded in the ledger,
  `windows-x86_64-cuda12.4` is **deferred and out of Gate 8 scope**: it is not a
  supported target and **must not block Gate 8.3, 9 or 10**.
- **Gate 8.3 and Gate 8 are complete** for macOS arm64 Metal, Linux CPU, Linux
  CUDA, and Windows CPU. Validation-only macOS regression run `29880520628` at
  clean remote revision `d07b6b4` passed preflight, native build, self-test,
  4 x 256 Metal scientific parity, Rust lifecycle, compact evidence upload, and
  cleanup. Final artifact `8514665653` has digest
  `sha256:b1b4911121897542bed0961bd0e93ac2ca88c7d17f6229913733a0a062630c74`.
  The run found no shared-builder incompatibility, so the already-live macOS
  box was not republished. The complete evidence audit, reviewed evidence
  import, shared-core/catalog alignment, and honest readiness/support matrix are
  also complete locally. CUDA is supported only on Linux; Windows CUDA remains
  buildable but unvalidated, unpublished, unsupported, and out of Gate 8.
- **Gate 9 macOS heavy runner: complete.** UCE resolves only
  to a checked repository-scoped, ephemeral, single-concurrency
  `liatir-macos-arm64-heavy` profile. The local launcher pins GitHub Actions
  runner `2.336.0`, requires a dedicated root outside the checkout, enforces a
  35 GiB bootstrap floor before any download or registration, installs no
  service, caps online time at 190 minutes, preserves diagnostics, and removes
  the complete marked runner root after success, failure, or interruption.
  Validation verifies the self-hosted execution context and exact `main`; the
  protected release retains OIDC to the private Cloud Run/KMS signer and no
  local signing key.
  - **First release attempt diagnosed; no publication occurred:** after the
    successful `39,284,838,400`-byte preflight and explicit activation approval,
    protected run `29889431937` used exact `main` revision `0c8310f`, resolve job
    `88826727465`, release job `88826776619`, and ephemeral runner
    `liatir-macos-heavy-1784692230-27603`. Host validation, OIDC, setup, exact
    revision, and every UCE asset download passed. The build then failed before
    self-test, signing, scientific validation, publication, or beta promotion:
    extracting the protein-embedding archive deleted sibling assets already in
    its destination, producing a missing-self-test-file error for
    `model-cache/uce/model_files/species_offsets.pkl`.
  - **Evidence and cleanup:** failed evidence artifact `8517777517` is 650 bytes
    with digest
    `sha256:084abf567d2750410e0c105f1b325363d43d9a07195003f5cc372f0b5eacad4a`.
    Workflow cleanup passed, the runner deregistered, the marked work root was
    removed, diagnostics were retained, runner inventory is empty, and the host
    recovered `38,710,562,816` free bytes.
  - **Builder fix:** archive extraction now preserves sibling
    assets and rejects collisions. Both regressions pass; catalog validation is
    green; the full verify profile passes 164/164 tests, SDK/core/Svelte/frontend
    and root builds; and Rust `runtime_box` passes 11 with one established large
    fixture ignored.
  - **Protected closure run:** after the fix was pushed at exact revision
    `8e1251274695b266fb52905e3e2d1a1b40a1b6ee`, freshly approved run
    `29909249357` passed resolve job `88887957863` and release job `88888035723`
    on exact ephemeral runner `liatir-macos-heavy-1784713742-2693`. Build, KMS
    signing, independent native self-test, UCE Metal scientific parity,
    immutable R2 publication with public hash verification, beta promotion,
    evidence upload, and workflow cleanup all passed.
  - **Produced evidence:** reviewed record
    `runtime-boxes/evidence/uce-4layer-macos-aarch64-metal-1.0.0-beta.1-run-29909249357.json`
    pins archive hash `63fc02de8e91699176510051be38790ab69739a92fe32052011081ad8297c960`
    and the KMS key. Artifact `8525984364` has digest
    `sha256:8166557f9953e4713e577558da5fe485d732e57aef299dbb54fb35630842fbaf`.
    The live signed beta channel was independently read and points at the new
    immutable manifest with 100% rollout.
  - **Runner cleanup:** listener exit `0`, local credentials/registration
    removed, diagnostics retained, repository runner inventory zero, marked
    root absent, and `43,393,630,208` free host bytes after cleanup. No heavy
    runner remains online.
- **Gate 10 operational handoff: complete.** The production report now records
  the reviewed run matrix, honest support boundary, protected workflows,
  environments, variable and secret names, WIF principal forms, service
  accounts, signer/Registry resources, commands, cost and authorization
  boundaries, cleanup, token/key rotation, and revocation stop conditions.
  Runtime Box, signer, Registry, compatibility, evidence, AI roadmap, readiness,
  and handoff documentation are aligned. Zero-cost closure gates passed:
  catalog 3 models / 3 fixtures, signer 11/11, verify profile 164/164 plus all
  builds/checks, and the complete internal documentation build. No remote or paid action
  was needed.

## How Gate 8.2 Windows CPU was closed (2026-07-19/20)

The Windows product lifecycle had never run end to end before, so each release
run surfaced the next Windows-only defect. The turning point was capturing the
self-test's stderr, which replaced opaque `exit code 1` failures with real
errors. Seven real causes were fixed (not symptom patches); the two marked
**PRODUCT** would have hit real Windows users, not just the test:

1. `scripts/runtime-box/heartbeat.mjs` spawned `npm` shell-free → ENOENT on
   Windows; now routed through the shared `npmInvocation` (unblocked the free
   foundation Windows validation).
2. **PRODUCT** — staging dir renamed from `.{runtime_id}.{uuid}.staging` to a
   short `.stg-{uuid}`: the long path pushed the box's nested `torch\lib\*.dll`
   past the Windows MAX_PATH (260) the DLL loader enforces (`WinError 206`).
3. **PRODUCT** — `venv_python` now resolves both interpreter layouts: a managed
   venv uses `Scripts\python.exe`, but the standalone box ships `venv\python.exe`
   (Unix layouts coincide on `bin/python`, so only Windows diverged).
4. E2E WebDriver script timeout raised to the app-side 600s Python job limit
   (cold torch/scipy imports exceeded the W3C 30s default).
5. E2E `navigate` uses client-side SvelteKit routing instead of a hard
   `window.location.href` reload, which dropped the WebDriver connection on
   Windows.
6. **PRODUCT** — reactive `$effect` in the root layout finalizes completed
   direct AI runs on any jobs-list change; previously finalization only ran
   while a job was polling or was triggered incidentally by a reload-remount
   (exposed when #5 removed the reload).
7. `rename_with_retry` (bounded backoff on transient Windows sharing/lock
   violations) on the activation, rollback, and download-rename paths; plus the
   diagnostic self-test stderr capture (`run_self_test`).

Commit trail on `main`: `69b7df2`, `657a52b`, `94d93e8`, `c6eba27`, `6534f1b`,
`4f82542`, `3503920`, `f067482`, then `35be12a` (docs). Roughly nine remote
Windows release runs were spent isolating these one at a time, because the
Windows lifecycle E2E cannot be reproduced on the macOS dev host.

## Historical hosted GPU runner snapshot (2026-07-20 — superseded)

This section records the old paid larger-runner configuration and the incidents
that occurred on it. It is not the current runner topology. The
`liatir-linux-t4` and `liatir-windows-t4` profiles were later deleted; current
Linux/Windows model-native validation resolves to reviewed on-demand
self-hosted profiles. Only coordination/preflight jobs remain hosted by design.

The CUDA runner labels `liatir-linux-t4` / `liatir-windows-t4` (catalog
`runnerProfiles`) are **GitHub-managed GPU larger runners**, not self-hosted and
not GCE VMs. Confirmed 2026-07-20: (a) the repo's Self-hosted runners tab is
empty and the maintainer hosts nothing locally; (b) Compute Engine was never
enabled in GCP `liatir-release-security` (that project hosts only the Cloud Run
signer `liatir-runtime-box-signer` + KMS); (c) GitHub offers GPU-hosted larger
runners (1x NVIDIA T4, 4-core) for **both Linux and Windows** on Team/Enterprise
plans — fully managed, auto-scaling. So there is nothing to power on by hand;
these runners are configured under org/repo Settings → Actions → Runners →
GitHub-hosted runners as custom-labelled larger runners, and cost per-minute
while running (the priciest hosted tier).
Ref: <https://github.blog/changelog/2024-07-08-github-actions-gpu-hosted-runners-are-now-generally-available/>

**The GPU runners ARE configured (confirmed in the org Runners UI once GitHub
recovered).** Liatir org → Settings → Actions → Runners shows `liatir-linux-t4`
and `liatir-windows-t4` (runner group "Liatir Runtime Box GPU"), both **Ready**.
The 2026-07-20 CUDA queue was purely a **transient GitHub Actions outage** that
night (runner-admin API 500/503, Runners page would not load); it was not a
missing/offline runner. An earlier note in this file that read "not configured"
was wrong — it reflected the outage showing incomplete data, now corrected.

**Cost:** GPU runners are GitHub-managed larger runners, auto-scale to zero (no
idle cost), billed per-minute only while running: Linux GPU (T4, 4-core)
$0.052/min (~$1 per Linux CUDA release ≈ 18 min), Windows GPU $0.102/min (~$3.5–4
per Windows CUDA release). Maintainer rule: **optimise for one passing run, never
use a GPU run as a debugger** (validate cheaply on standard runners / locally
first).

## Historical next-steps ledger (superseded 2026-08-10)

> **Current strategic routing (2026-07-27):** the [Runtime Box pixi
> migration](../history/runtime-box-pixi-migration.md) owns Liatir recipe,
> self-hosted-runner and scientific migration. The independent external
> Scrollcase package owns the generic pixi builder, and
> [Scrollcase P5](../history/scrollcase-p5-liatir-adoption.md) owns downstream
> adoption/legacy retirement. Phases 0–4 of the pixi migration are complete;
> Phase 5 is in progress; the historical v1 P5.2 checkpoint, v2-only P5.2V
> cutover and all three native P5.3 foundation proofs are complete. P5.4 model
> recipe migration is complete: all five scGPT targets are v2 and natively
> proven, and so is Geneformer's entire current matrix — macOS Metal plus the
> `linux-x86_64-cuda12.9` and `windows-x86_64-cuda12.8` successors — and UCE.
> Geneformer's CPU targets were dropped once CPU throughput was measured, so it
> has no CPU box at all. **P5.4V is complete as of 2026-08-07: all eleven targets
> are rebuilt and measured on `scrollcase@0.7.1`. P5.4W then raised the pin to
> `0.8.0`, which changes no archive byte, so that matrix stands as measured. P5.4P
> has published and promoted all three macOS boxes on 2026-08-08, and the six
> Linux/Windows targets followed: all nine targets are published, and the two
> superseded `beta.1` versions were revoked on 2026-08-10 (see the top of this
> file). P5.5 subsequently retired the remaining local generic helper copies.**
> That checkpoint's next continuation was P5.6; P5.6 and the P5.7 handoff have
> since completed, as recorded at the top of this file.
> P5.4 remained one phase with
> three operational blocks rather than a new numbered checkpoint per target.
> Do not use the historical
> platform-expansion target table as a dispatch source.

1. Continue the [pixi migration](../history/runtime-box-pixi-migration.md) Phase 5,
   which has **reframed and largely absorbed** the old model-platform-expansion
   plan. Done: the `29955615971` signing failure was diagnosed (deployed-signer
   policy drift, now auto-detected before every release), and all five scGPT
   targets plus Geneformer macOS Metal, Linux CPU and Windows CPU are natively
   proven on v2, as are Geneformer's CUDA successors and UCE.
   Remaining: the protected re-release of the rebuilt matrix. Every target is
   migrated and natively validated, so no migration work is left here.
   Windows CUDA is no longer under the no-dispatch decision — it now validates on
   the self-hosted RTX 4060 Ti.
   **The re-release is done on macOS (2026-08-08).** All three boxes are
   KMS-signed, scientifically validated on Metal, published as immutable
   content-addressed objects and promoted to `beta` at 100%: `scgpt-whole-human`
   `0.2.5-beta.2` (run `31228656398`), `geneformer-v1-10m` `1.0.0-beta.2`
   (`31229152183`), `uce-4layer` `1.0.0-beta.2` (`31230276512`). Every channel
   was read back from the public registry and every installed size reproduces the
   rebuild measurement exactly.
   **It took six runs to get the first one through**, because release CI had run
   nothing between the v2/pixi cutover and this re-release and had drifted behind
   it in six places — `npm ci` after the first script that imports Scrollcase, a
   signer smoke payload still on `schemaVersion: 1`, no pinned pixi at all, a
   stem-named archive lookup where the format uses the SHA-256, a flat channel
   path where the builder files by channel, and `scrollcase-consumer` missing from
   the *generated* Cargo manifest. All fixed and pinned by regressions; the two
   path defects now resolve through one shared helper each. **Both the signer and
   the Registry Worker were stale deployments** — the Worker was still on
   2026-07-15, before the cutover, and refused every v2 document — and had to be
   replaced, which this plan listed under non-goals.
   Remaining: the six Linux/Windows targets, which need their own hosts and
   should now pass first time since every defect was in shared code; and retiring
   the superseded `beta.1` versions, which needs multi-entry revocation support
   (the Worker replaces the revocations document wholesale, so one entry at a
   time would leave only the last) plus a KMS-authorized principal. Low urgency:
   the `beta.1` documents are `schemaVersion: 1`, which the v2-only app already
   refuses. Full record in
   [P5.4P](../history/scrollcase-p5-liatir-adoption.md).
2. **The Scrollcase pin is raised to `0.7.1` and the whole rebuild matrix is
   complete (2026-08-07).**
   The 2026-08-04 hold ("do not raise the pin during P5.4") was **lifted by the
   maintainer on 2026-08-06** and the pin moved. The hold existed to protect
   recorded evidence, and Liatir is unreleased, so no user depends on that
   evidence; leaving UCE — the largest build in the matrix — to be authored on
   `0.4.11` and then rebuilt, or frozen alone on an older builder, was the worse
   trade. So the order was inverted: raise first, author UCE once, publish after.
   **UCE is now authored** (`4f84c34`): a single v2 scroll on `0.7.1`, lock
   `a539412003c6ac355da2ce1dca05b7aa76ef3274a71150839c0b3396ae824a98`, 194
   conda-forge packages with no undeclared licence, all twelve `venv` prune
   paths dropped and `uncompressedPaths` naming the protein-embedding tree. No
   uv recipe remains anywhere in the repository. **UCE then passed native
   validation on the first dispatch** (run `31070450837`, jobs `92517133620` and
   `92517203321`, runner `liatir-macos-heavy-1785989332-65951`, clean commit
   `07e01f6`): frozen build, signature and archive verification, self-test, the
   real Metal scientific validator and the full Rust lifecycle, in 16 minutes.
   Archive SHA-256
   `d08f7c80e00ee82686b5d5f1b5863f650cc8281b9a217928c095ea26699fe29f`. Metal
   parity on the fresh torch 2.8.0 baseline came in at minimum cosine
   `0.9999999999904319` and maximum absolute difference
   `4.0046870708465576e-7`, so moving off torch 2.1.1 cost nothing measurable.
   Both disk estimates were **low**: installed `11169027146`, archive
   `9899283947`, pushing the calculated peak past the old floor, which is now
   `36507222016` — dropping the twelve `venv` prune paths grew the box more than
   carried links and stored weights shrank it. **P5.4 is therefore complete**:
   every model target is v2 and natively proven. It stays `published` against the
   immutable v1 uv objects; nothing was signed, published or promoted.
   The pin is exact `scrollcase@0.7.1`, identity read back from npm into the
   lockfile, and the JavaScript surface turned out purely additive — no Liatir
   call site changed. `scrollcase-consumer 0.1.2` was already ahead of the
   format and did not move. The macOS foundation fixture rebuilt and passed the
   whole chain, which is what found the two real defects: `runExtractedBox` now
   returns an `environmentReport` the fixture compared away, and `dir_size`
   skipped payload links entirely, under-counting an installed box by 15638
   bytes and rejecting a valid one at the declared-size check. Both fixed, the
   second with a unit test. **The schema-v1 uv authoring path is now deleted**
   (`f467399`): `runtime-boxes/recipes` is gone, the resolver has no legacy
   branch, the uv licence validator is gone, and both workflows lost their
   pinned-uv install. The guards that keep uv out stay.
   **The local builder is now deleted too** (`5f52f5e`). `legacy-cli.mjs` had
   been kept through the rebuild matrix only because the distribution half of the
   same file is what a release runs; the matrix is closed, so it went: 515 lines
   covering `buildRecipe`, `lockRecipe`, `verifyRelease` (which had no dispatch
   entry at all and was dead twice over), `findUv`, and the
   licence/pixi/python/target-adapter imports only they used. Two reachable
   helpers moved rather than died, since a validator needs each —
   `downloadVerified` to `assets.mjs`, and the payload-archive wrapper to
   `archive.mjs` as `extractPayloadArchive`, which also ends the confusion of two
   different functions sharing the name `extractRecipeArchive`. The file is now
   `distribution-cli.mjs`: nothing in it is legacy — it owns R2 publication, the
   Worker trust root, promotion, revocation and the loopback registry — and a
   deletion guard fails if a builder grows back.
   **Rebuilds: all three macOS targets are done and measured** — UCE
   (`31070450837`), scGPT (`31103405667`), Geneformer (`31104336539`). The format
   effect is consistent: scGPT −26%, Geneformer −29% from carried links and
   stored assets alone, while UCE gained 10% because its migration also dropped
   twelve `venv` prune paths. Geneformer's Metal parity reproduced its `0.4.11`
   figures exactly, so the archive changed and the science did not.
   **The remaining eight rebuilds are now done (2026-08-07), each on one
   dispatch with no retry**, on the maintainer's self-hosted WSL and Windows
   hosts: the Linux fixture (`31114218644`) and Windows fixture
   (`31115179668`); scGPT Linux CPU (`31140132988`), Windows CPU
   (`31141105901`), Linux CUDA 12.9 (`31142985671`) and Windows CUDA 12.8
   (`31145063888`); Geneformer Linux CUDA 12.9 (`31182952388`) and Windows CUDA
   12.8 (`31185755710`). The four GPU runs were explicitly authorized by the
   maintainer on 2026-08-07 and ran Linux-before-Windows per the catalog rule.
   Every lock reproduced byte-identical and every parity figure reproduced its
   `0.4.11` value exactly, including all four CUDA targets. **All eleven targets
   are on `0.7.1` with measured `diskPlan`s; nothing is published, so no identity
   breaks, and the release remains one separate authorized decision.**
   **The size effect splits on platform and nothing else**: the four Windows
   targets moved `+0.3%`/`+0.2%`/`+0.05%`/`+0.05%` while the POSIX ones moved
   `−53%`/`−43%`/`−32%`/`−52%` (plus macOS `−26%`/`−29%`). conda materialises
   files on Windows instead of linking them, so a Windows payload has no link
   entries for the `0.6.0` rule to carry. The two CUDA pairs prove it by holding
   the model constant and varying only the OS. **Never infer a Windows
   `diskPlan` from a POSIX measurement or the reverse** — it is wrong by about a
   factor of two in either direction.
   **Operating hazard:** a push touching a model workflow's path filters cancels
   that model's in-flight dispatched native run, through the shared concurrency
   group with `cancel-in-progress`. Run `31102785007` was lost this way.
   **The pin then moved again to exact `scrollcase@0.8.0` (2026-08-07), and this
   one costs nothing.** Diffed against the `0.7.1` tarball it touches only
   `CHANGELOG`, `package.json`, `build/verify`, the two consumer entry points and
   `sign`; `src/contract` is byte-identical and no archive-producing code moved,
   so **the eleven-target matrix carries over without a single rebuild**. The
   change is additive — every operation now accepts `publicPath` *or*
   `trustedKeys`, and `verifySignedDocument` still takes a path — so again no
   Liatir call site changed. `test:verify` 6/6, 42/42 Rust tests, and the macOS
   native fixture lifecycle green on the new pin — and the fixture proves the
   diff empirically, rebuilding to archive `54172964` and installed `146593318`
   bytes, the exact figures the catalog recorded from its `0.7.1` build.
   **P5.4R is no longer blocked upstream.** The gap was that
   `verify_extracted_payload` and `attach_extracted_box` took a trust-key *file*
   while Liatir compiles its anchors into the binary;
   `scrollcase-consumer 0.2.0` replaced that field with `trust: TrustAnchors`,
   which takes keys directly, and Liatir already pins `=0.3.0`. What remains is
   Liatir work to schedule, not an upstream wait.
   See [P5.4V](../history/scrollcase-p5-liatir-adoption.md).
3. The cross-version update and client-persisted signed anti-replay lifecycle is
   now product-verified on macOS arm64, native Windows x86_64, and WSL2 Linux
   x86_64; it is not an unclosed foundation gate.
4. Continue with the common execution spine in Phase 2 after that bounded
   Runtime Box product work.
5. Do not add another model family to the pre-release catalog until current
   model parity is closed and its code, weights, and assets pass an exact legal
   review. The candidate classification lives in `.context/state/roadmap/ai-batches.md`.
6. Do not dispatch another Gate 9 UCE release; the on-demand runner remains
   offline unless a separately reviewed future heavy build requires it.
7. Both Geneformer CUDA 12.4 targets were deleted on 2026-08-04. They have
   successors as of 2026-08-05 with fresh identities: `linux-x86_64-cuda12.9` and
   `windows-x86_64-cuda12.8` are both native-lifecycle proven with measured disk
   plans, and both are unpublished, so nothing remains to dispatch there.
   Releasing either needs a separate explicit authorization. scGPT Windows CUDA
   12.8 has self-hosted scientific evidence but remains unpublished; any further
   validation or release still needs one explicit reviewed target authorization.
8. **DONE 2026-08-05, and it failed.** The measurement did not need a published
   box after all: the v2 scroll was built and signed locally with a local key,
   verified with `verify --self-test`, and measured directly — no channel, no
   publication, no uv-era box. On Apple Silicon, running the shipped product
   script under `LIATIR_AI_FORCE_CPU=1` at batch size 16 over 1024 genes:
   500 cells in `74.8` s and 2000 cells in `321.9` s, linear at **~160 ms per
   cell**, ~4 GB peak RSS. That extrapolates to **~27 minutes for 10 000 cells**
   and **~2.2 hours for 50 000**, past the CPU-gating policy's own "would take
   hours, or is otherwise too slow to be useful" line. **The repeated claim that
   Geneformer V1 10M is trivially fast on CPU holds only for the 4-cell
   validator fixture and is retired.** The earlier CPU-beats-CUDA reading
   (`11073` ms against `15104` ms) measured startup overhead, nothing else.
   Consequently the **no-CUDA-successor half** of the 2026-08-04 decision does
   not stand; deleting both 12.4 identities does stand, and a successor is still
   purely additive. **The successor question is now answered in code
   (2026-08-05):** both CUDA successors were added, the Geneformer CPU boxes were
   dropped, and Linux CUDA 12.9 is native-lifecycle proven — see the block 3
   paragraph above for the run evidence. Still open: the unmeasured Metal
   comparison, which would say whether Apple Silicon is comfortable at realistic
   cell counts, and the dispatch of Windows CUDA 12.8, which needs its Linux
   prerequisite recorded in the catalog before its gate opens.
9. **Re-release each migrated target before any user-facing install claim.**
   Every v2 target is natively proven but unpublished, so the public beta
   catalog is uninstallable by the current app. This is a release blocker for
   the product, not an open Runtime Box CI gate: the gates passed. Each
   protected release still needs the maintainer's explicit per-target
   authorization and a prior `runtime-box:signer:deploy`. Re-check the split
   `publication` blocks in `runtime-boxes/catalog.json` as part of that work.

## Standing constraints

- No paid, remote, publishing, or release action from memory — read back the
  exact workflow, inputs, and revision first (see `AGENTS.md` and the Runtime Box
  plan's operating rules). GPU runners are manual-only and need explicit cost
  approval.
- Keep user-owned roadmap edits out of technical commits.
- Update this file and the Runtime Box ledger whenever a gate changes state.
- **Windows path length is a shared budget, and the product owns most of it.** The
  app spends 84 characters between the app data directory and the box's own tree
  (`.liatir\.main\data\ai-runtimes\<runtime-id>` plus staging), and a packaged conda
  environment brings paths over 110 more. A real install of the largest box reaches
  245 characters for a five-character user name and 258 for an eighteen-character
  one, against Windows' 260 limit for anything not long-path aware — which includes
  the box's Python. Shortening that prefix would return thirty characters, but every
  installed box already lives there, so it is a migration and not a cleanup. Do not
  answer a MAX_PATH failure by enabling long paths on a machine: that fixes one host
  and no user.
- **CPU support per AI Model is not mandatory.** A CPU Runtime Box ships only if
  the model finishes a realistic reference dataset inside an acceptable wall-clock
  time. The decision is per-model and based on measured throughput, never on the
  binary "it runs". If CPU takes hours, the CPU box is not shipped and the UI says
  the model needs a GPU or Metal. Shipping a technically-working but hours-slow box
  is a false promise to a non-technical user. Maintainer decision, 2026-07-23; the
  reference dataset size and the acceptable wall-clock are still to be set.
- **Scrollcase's maintainer is Liatir's maintainer.** Where a plan says "stop and
  ask the Scrollcase maintainer", that is an upstream API design conversation with
  him, not an external blocker. The vendor-neutrality rule still holds: Scrollcase
  never learns Liatir vocabulary, credentials or policy, and this repository never
  deep-imports or edits Scrollcase source.
- **Never assert the shape of a failure before reading its cause.** Install status,
  job status and install errors are all recorded by the app; on an ephemeral runner
  they disappear with the job. Read the error, then assert.
