# Scientific Simulation Suite

The canonical, persistent execution plan for adding molecular docking, virtual screening, trajectory
analysis, biochemical networks, metabolic modeling and multicellular simulation to Liatir. **Read this
page before continuing any of that work**, and update it in the same change as any progress.

**Status (2026-11-03): Phase 2 in progress — the molecular docking box is built, scientifically
validated on a development-signed build, and integrated in the product; the real-app lifecycle is
next.** GNINA is **BLOCKED** on a redistribution decision (B1). Nothing is published; no paid, remote
or GPU CI action has been taken. All work is on branch `simulation-suite`, not pushed.

## Objective and scope

Deliver scientifically validated, local-first capabilities, each one a real Liatir Tool backed by a
signed Scrollcase v3 Runtime Box, with Jobs, Results, provenance and pipeline steps:

| Capability | Upstream software | Phase |
| --- | --- | --- |
| Molecular preparation, docking, virtual screening | AutoDock Vina, RDKit, Meeko, PDBFixer, Ringtail | 2 |
| Neural pose scoring | GNINA | 3 |
| Trajectory and interaction analysis | MDAnalysis, ProLIF | 3 |
| Biochemical reaction networks | PySB, BioNetGen | 4A |
| Constraint-based metabolic modeling | COBRApy with a reviewed open-source solver | 4B |
| Multicellular simulation | PhysiCell | 4C |

Out of scope: macOS, native Windows boxes, GROMACS, AutoDock-GPU, OpenFE, ADMET-AI, automatic
multiscale coupling, unrelated refactoring. The published OpenMM Tool Runtime must keep working and
is extended only through interoperability.

## Support matrix

| Host | CPU boxes | CUDA boxes |
| --- | --- | --- |
| Linux x86_64 | target | target |
| Windows 11 through WSL2 | target (the Linux box) | target (the Linux box) |
| Native Windows, macOS | excluded | excluded |

Every new box is a Linux target with `hostEnvironments: ["native", "windows-wsl2"]`, following
[no native Windows targets](../../decisions/no-native-windows-runtime-box-targets.md). Where an
upstream package also supports macOS, that is recorded and nothing more.

## What must not change

- The thirteen published targets, their channels and evidence; `runtime-boxes/trust/`,
  `runtime-boxes/target-id-contract.json`, and published catalog entries.
- OpenMM's scrolls, locks, product metadata and its two tools (Molecular Relaxation, Molecular
  Dynamics). New work consumes their outputs; it does not edit them.
- The shared I/O contract in `packages/liatir-core`: extended backward-compatibly, never forked.
- `services/runtime-box-signer/policy.json` changes only as part of an authorized release (B3).

## Working environment

All development, builds and validation run inside WSL2, never on native Windows and never from
`/mnt/c`.

- Checkout: `/home/lorenzo/liatir-stack-gate8-mcp` (the existing clean Linux checkout, fast-forwarded
  from `5bd54a9f` to `18f77616` on 2026-11-03, origin set to `Liatir/liatir-app`), branch
  `simulation-suite`. Editors on Windows reach it as `\\wsl.localhost\Ubuntu\home\lorenzo\liatir-stack-gate8-mcp`.
- Box builds and scratch work: `~/liatir-build/` (ext4; conda sysroots need a case-sensitive
  filesystem). Phase 1 resolver workspaces are in `~/liatir-build/suite-feasibility/`.
- Toolchain measured 2026-11-03: Node 22.14.0, npm 10.9.2, pixi 0.73.0 at
  `~/.pixi-versions/0.73.0/bin/pixi` (the version every scroll pins) and 0.77.0 at
  `~/.pixi/bin/pixi`, Rust 1.95.0 in `~/.cargo/bin`, g++ 15.2.0, GNU make 4.4.1, gh 2.46.0
  (authenticated), Syngraphe 0.4.1 through Windows interop. No cmake.
- Host measured 2026-11-03: Windows 11 Pro build 26200; WSL2 Ubuntu 26.04 LTS, kernel
  6.18.33.2-microsoft-standard-WSL2; 6 vCPU; 12,543,180,800 bytes RAM and 4 GiB swap visible to
  WSL2; NVIDIA GeForce RTX 4060 Ti, 8,188 MiB, compute capability 8.9, driver 610.88; 757 GB free.

## Verified starting state (2026-11-03)

- `main` = `origin/main` = `18f77616` (desktop 0.3.1 published). The only pending change in the
  Windows checkout is an untracked prompt file the owner wrote; it is the owner's and stays out of
  commits.
- Tool Runtimes already in the product: pVACseq (CPU) and OpenMM 8.5.1 (`linux-x86_64-cuda12.9`,
  published 2026-10-28; see [OpenMM CUDA publication](../../history/openmm-cuda-publication.md)).
  A Tool Runtime is declared in `packages/liatir-core/src/tool-runtime-catalog.ts`, runs Python
  inside its activated box through `frontend/src/lib/tool-runtimes/runtime.ts`, and its tools are
  `type: 'tool-runtime'` step definitions with typed inputs, outputs and artifact profiles.
- OpenMM's preparation is `Modeller.addHydrogens` plus optional TIP3P-FB solvation. It requires
  complete heavy atoms and refuses an unparameterizable residue by name. Its dynamics write a DCD
  trajectory, a viewer topology PDB, a final mmCIF, a state CSV and a checkpoint
  (`frontend/src/lib/tools/molecular-simulation/python-scripts/openmm.ts`).
- Scientific artifact profiles exist for AnnData, FASTA, A3M, VEP tumour VCF, molecular structure
  (PDB/mmCIF), neoantigen report and DCD trajectory (`packages/liatir-core/src/scientific-artifacts.ts`).
  Nothing yet describes a small-molecule SDF, docked poses, a screening database, an SBML model or a
  simulation time series.
- Scrollcase 1.4.0 builds `python`, `node` and `native` boxes from a committed `pixi.lock`
  (`pixi install --frozen`), supports hashed `assets`, `assetArchives` (zip, tar.gz), `prunePaths`,
  a `pypiLicenseDeclaration`, and a `bundledLicenseDeclaration` for code compiled into a supplied
  binary. It has **no compile step**: native code must arrive as a conda package or a hashed asset.

## Upstream versions selected

Verified 2026-11-03 from conda-forge repodata (`pixi search`) and the GitHub releases and licence
APIs. Licences are the upstream statements, read from the licence files where GitHub's detection
said `NOASSERTION`.

| Component | Version | Upstream release | Licence | Delivered from |
| --- | --- | --- | --- | --- |
| AutoDock Vina | 1.2.7 | 2025-02-26 | Apache-2.0 | conda-forge `vina` (official Python bindings) |
| RDKit | 2024.09.6 (docking) / 2026.09.1 (analysis) | — | BSD-3-Clause | conda-forge |
| Meeko | 0.8.0 | 2026-08-27 | LGPL-2.1-only | conda-forge |
| PDBFixer | 1.12 | 2025-10-30 | MIT | conda-forge |
| OpenMM (PDBFixer's library) | 8.5.1, build `py311h6619805_0` | — | MIT core; LGPL-3.0+ GPU platforms | conda-forge, the OpenMM box's exact build |
| Ringtail | 2.3.1 | 2026-05-13 | LGPL-2.1-only | conda-forge (2.3.3/2.3.4 exist on GitHub only; they fix database attach/detach, unused here) |
| chemicalite (Ringtail dependency) | 2024.05.1 | — | BSD-3-Clause | conda-forge |
| GNINA | 1.3.3 | 2026-06-29 | GNINA code GPL-2.0 or Apache-2.0; the binary is GPL-2.0 (links OpenBabel) | GitHub asset `gnina.cuda12.8.static`, 2,056,131,000 bytes, SHA-256 `3340c1f49cd3c7c84d8699182a1c6af13c7fa2a22448d1204640446106f72172` |
| MDAnalysis | 2.11.0 | 2026-10-21 | LGPL-3.0-or-later as packaged (contributions LGPL-2.1+) | conda-forge |
| ProLIF | 2.2.3 | 2026-10-09 | Apache-2.0 | conda-forge |
| PySB | 1.17.0 | 2026-02-17 | BSD-2-Clause | PyPI wheel, SHA-256 `8e2b8d23d44443686a88056afe126b308a6fa9b635e44169e7ea16e07984a55f` (not on conda-forge) |
| BioNetGen | 2.9.3 | 2025-04-21 | MIT | GitHub asset `BioNetGen-2.9.3-linux.tar.gz`, 2,221,958 bytes, SHA-256 `b85743d422aa3fd112aceb3725dd1b1f2ff1ad829d20d71682680426582bcb5d` |
| COBRApy | 0.32.1 | 2026-08-11 | LGPL-2.0-or-later OR GPL-2.0-or-later | conda-forge |
| optlang | 1.9.1 | — | Apache-2.0 | conda-forge |
| HiGHS (`highspy`) | 1.15.1 | — | MIT | conda-forge |
| GLPK / swiglpk | 5.0 / 5.0.13 | — | GPL-3.0-or-later / GPL-3.0-only | conda-forge (hard dependency of cobra and optlang) |
| PhysiCell | 1.14.2 | 2025-01-20 | BSD-3-Clause (PhysiCell, BioFVM, MaBoSS); MIT (pugixml) | GitHub `PhysiCell_V.1.14.2.zip`, 12,384,340 bytes, SHA-256 `15b190ac3420683b1f8e9d61dd9573b7afe0f6bc4c0011b0b0756693ccd0b9f4` |

Python is 3.11 in every new box: the existing boxes use it, ProLIF requires ≥ 3.11, PySB ≥ 3.11 and
Meeko < 3.14.

## Runtime Box boundaries

Decision record: [simulation suite Runtime Box boundaries](../../decisions/simulation-suite-runtime-box-boundaries.md).

| Box | Components | Target | Why this boundary |
| --- | --- | --- | --- |
| `molecular-docking` | Vina, RDKit, Meeko, PDBFixer (+ OpenMM library), Ringtail | `linux-x86_64-cpu` | One chemistry stack: Ringtail requires Meeko and RDKit, Meeko writes what Vina reads and reads back what Ringtail stores, and chemicalite pins RDKit 2024.09.6 for all of them. PDBFixer completes heavy atoms Meeko's templates require, and must work without an NVIDIA GPU. |
| `gnina` | GNINA | `linux-x86_64-cuda12.8` | A 2 GB CUDA binary with its own licence and failure boundary. Blocked (B1). |
| `molecular-analysis` | MDAnalysis, ProLIF, RDKit | `linux-x86_64-cpu` | Consumes OpenMM trajectories and docked poses; 188 packages that docking users do not need, and a newer RDKit than the docking box can hold. |
| `biochemical-simulation` | PySB, BioNetGen, Perl | `linux-x86_64-cpu` | PySB cannot generate networks without BioNetGen: one capability. |
| `metabolic-modeling` | COBRApy, optlang, HiGHS, GLPK | `linux-x86_64-cpu` | Independent domain, released independently. |
| `physicell` | PhysiCell executables, Python result reader | `linux-x86_64-cpu` | Native C++/OpenMP, independent release. |

Rejected: one box per Python package (six boxes would duplicate RDKit and split one docking
workflow across file hand-offs); one "systems biology" box for PySB and COBRApy (unrelated and
independently versioned, and Phase 4 requires independent release); folding PDBFixer into the OpenMM
box (that box is published CUDA-only, so docking preparation would require an NVIDIA GPU, and
changing it means a full OpenMM re-release).

## Phase 1 feasibility findings

Each was checked, not inferred; the evidence is named.

1. **Every CPU environment resolves** with pixi 0.73.0 (lock only, no install), 2026-11-03:
   docking 152 packages, analysis 188, metabolic 86, biochemical 41. Resolver workspaces in
   `~/liatir-build/suite-feasibility/`.
2. **The docking stack's RDKit is fixed at 2024.09.6** by chemicalite 2024.05.1, Ringtail's
   dependency. Meeko 0.8.0 and Vina 1.2.7 accept it.
3. **Unconstrained, OpenMM pulls CUDA 13.4 libraries** into the docking environment
   (`cuda-nvrtc 13.4.92`, `cuda-version 13.4`). Pinning `openmm` to build `py311h6619805_0` and
   `cuda-version 12.9.*` gives the OpenMM box's exact library, so PDBFixer and the OpenMM tools
   share residue templates and hydrogen rules.
4. **PDBFixer does not duplicate OpenMM preparation.** OpenMM's `Modeller.addHydrogens` needs
   complete heavy atoms; Meeko's receptor templates require heavy atoms to match exactly ("If heavy
   atoms are missing or in excess, the templates will fail to match", Meeko 0.8.0
   `docs/source/rec_overview.rst`). PDBFixer's missing-atom and missing-residue repair closes that
   gap; hydrogens are then added with the same OpenMM library either tool uses.
5. **Meeko takes protonation states from the residue name** (HID/HIE/HIP, LYN, …), adds missing
   hydrogens with RDKit without minimization, and raises on unmatched residues unless told to delete
   them. Liatir must surface unmatched residues and never pass a delete option silently.
6. **Ringtail stores one receptor per database and does not detect different binding pockets on
   the same receptor** (Ringtail command-line documentation). For Vina it keeps the three best poses
   by default; interactions require the receptor PDBQT. Liatir must own experiment identity (D5).
7. **The official reference exists in the Vina repository at v1.2.7**:
   `example/basic_docking/data/1iep_receptorH.pdb` and `1iep_ligand.sdf` (c-Abl kinase domain with
   imatinib, PDB 1IEP), plus the official solution files including `1iep_ligand_vina_out.pdbqt` and
   `1iep_receptor.box.txt`. The tutorial's Vina run (exhaustiveness 32) reports −13.23 kcal/mol for
   the top mode and says the best score is "around −13 kcal/mol". It states no RMSD threshold.
8. **GNINA is on neither conda-forge nor bioconda.** v1.3.3 ships one asset, a 2.06 GB static
   CUDA 12.8 Linux binary. GNINA's README: "gnina is dual licensed under GPL and Apache. The GPL
   license is necessitated by the use of OpenBabel"; `LICENSE.GNU` is GPL-2.0, and OpenBabel is
   GPL-2.0-only. See B1.
9. **MDAnalysis and ProLIF resolve together** with RDKit 2026.09.1.
10. **PySB is only on PyPI** and pins `sympy<1.12`; the environment resolves with sympy 1.11.1 and
    Perl 5.44.0. BioNetGen 2.9.3's Linux binaries (`run_network`, `NFsim`) need glibc ≥ 2.34 and
    `GLIBCXX_3.4.29` (read with `objdump -T`), carry a harmless RUNPATH into the upstream CI
    directory, and the tarball includes macOS `._*` resource-fork files that must be pruned.
11. **COBRApy hard-depends on GLPK (GPL-3.0) and on httpx**, which it uses to download models from
    BiGG/BioModels. HiGHS (MIT) resolves alongside it. Execution must deny network access and accept
    only bundled or user-supplied models.
12. **PhysiCell has no conda package.** Its upstream prebuilt sample executables (`template`,
    `rules`) link only libc/libm, require **glibc ≥ 2.38** (Ubuntu 24.04 or newer) and use AVX
    registers; Ubuntu 22.04, still common under WSL2, has glibc 2.35. See B2.

13. **Scrollcase 1.4.0 copies every directory symlink in full, and conda's Python ships
    `lib/python3.1 -> python3.11`**, so every Linux Python box Scrollcase builds carries its whole
    Python library twice (`settleSymlinksInPlace` in `scrollcase/src/build/pixi.mjs`). Measured: the
    docking payload held a 638 MB copy; the OpenMM CUDA development payload a 1.1 GB one. Docking
    prunes it (`prunePaths`); the published boxes still carry it (see "For the owner").
14. **PDBFixer lets OpenMM pick the fastest platform** (`mm.Context(system, integrator)` without a
    platform, `pdbfixer.py` 1.12), so on a machine with an NVIDIA GPU repairs would run on CUDA. The
    adapter names the CPU platform, which PDBFixer also hands to `Modeller.addHydrogens`, with
    `OPENMM_CPU_THREADS=1`. The GPU plugins stay in the box: a packed conda prefix ships whole (the
    rule `runtime-box-cost-controls.test.ts` enforces after scGPT lost a lazily imported package).
15. **Meeko's own PDB reader rejects a residue whose atoms are not contiguous**; the official
    `1iep_receptorH.pdb` lists one Ser438 hydrogen at the top of the file. The adapter uses the path
    `mk_prepare_receptor -i` takes: ProDy with `altloc="all"`, charges from the residue templates.
16. **Ringtail starts `max_proc - 1` readers beside one writer**, so `max_proc=1` starts none and
    waits forever. The adapter passes 2, and hands the results to a fresh interpreter so Ringtail
    never forks a process that has run Vina's thread pool.
17. **OpenMM's mmCIF reader names chains by `label_asym_id`**, which files every ligand, ion and
    water group under a chain of its own. "Keep chain A" therefore removed chain A's own imatinib
    and chloride ions as "other chains". Found by the validator; chain selection now translates to
    author chains (`author_chain_names`) and the validator holds it.
18. **PDBFixer 1.12 silently skips hydrogens on residues it cannot define offline**, and Meeko then
    tries to download a template. The adapter refuses any residue without a bundled Meeko template
    by name before hydrogens are added. Meeko 0.8.0 templates water and Cl, Br, F, I, Zn, Mg, Ca,
    Mn, Fe and Cu ions, but no drug-like ligand or cofactor (HEM, NAD, ATP): a receptor with a bound
    cofactor cannot be prepared by this tool yet (limitation L1).
19. **Receptor hydrogens written by other tools cannot be merged** with OpenMM's: Reduce names
    `HN`/`HB1` where OpenMM names `H`/`HB3`, and adding hydrogens on top duplicated them (an RDKit
    valence error). Receptor Preparation replaces every input hydrogen and re-protonates at one pH;
    a receptor protonated elsewhere enters Molecular Docking directly as its own PDBQT.

## Licensing and redistribution review

The project rule is [copyleft dependencies in signed boxes](../../decisions/copyleft-dependencies-in-signed-boxes.md):
allowed when the licence text travels and the component stays a separable, unmodified package or
process. Separate packaging alone does not discharge an obligation; each box's legal record under
`runtime-boxes/legal/` must show how each is met.

| Box | Copyleft or restricted components | Obligation and how it is met |
| --- | --- | --- |
| `molecular-docking` | Meeko, Ringtail (LGPL-2.1-only); OpenMM GPU platforms (LGPL-3.0+); conda GPL-family runtime libraries | Unmodified, replaceable Python packages with their licence files; disclosed in the audit and legal record, as in the OpenMM box. |
| `gnina` | The GNINA binary as a whole is GPL-2.0 (OpenBabel); it ships with NVIDIA libraries | Binary redistribution requires complete corresponding source. Whether the official static binary combines GPL-2.0 code with non-system proprietary libraries in one executable must be established by inspection before any redistribution. **B1.** |
| `molecular-analysis` | MDAnalysis (LGPL-3.0+) | Unmodified Python package with licence text. |
| `biochemical-simulation` | None in PySB (BSD-2) or BioNetGen (MIT); Perl (Artistic/GPL dual) | Licence texts; BioNetGen's bundled code listed in a `bundledLicenseDeclaration` (its binaries link SUNDIALS, BSD-3). |
| `metabolic-modeling` | COBRApy (LGPL/GPL choice; LGPL elected), GLPK and swiglpk (GPL-3.0) | Unmodified packages, separate shared libraries, licence texts; GLPK is a dependency, HiGHS the default solver. |
| `physicell` | None (BSD-3-Clause, MIT) | Licence texts from `licenses/`; compiled code declared in `bundledLicenseDeclaration`. |

Data: PDB entries are CC0 (wwPDB); the Vina example files are Apache-2.0 with the Vina repository;
the COBRApy test models ship inside COBRApy. Each fixture's source and licence goes into its legal
record before it is committed.

## Security review

- **No network during execution.** Every adapter denies sockets the way the OpenMM script does
  (`deny_network`); COBRApy's and Meeko's download paths stay unreachable. Meeko's
  `mk_prepare_receptor` can fetch from the PDB; Liatir calls its Python API on local files only.
- **No shell construction.** Vina, Meeko, PDBFixer, Ringtail, MDAnalysis, ProLIF, COBRApy and PySB
  are called through their Python APIs. BioNetGen, PhysiCell and GNINA are separate processes started
  with an argument vector, a fixed executable path inside the box, and a run-owned working directory.
- **No untrusted code.** PySB models are Python: only reviewed built-in models run, and user models
  come as declarative BNGL imported without its actions block. PhysiCell runs reviewed executables on
  validated XML/CSV configurations; it never compiles user C++. SBML is data.
- **Bounded inputs.** File size and atom/ligand/reaction/cell limits are checked before heavy imports,
  as OpenMM's preflight does; paths are resolved and confined to inputs and the run's output directory.
- **Cancellation and cleanup** use the existing Job settlement barrier and per-run process groups.

## Hardware and resources

Every capability records measured CPU time, wall time, peak RSS, disk use and (GNINA) peak VRAM on
this host, with the method in [VRAM measurement](../../decisions/vram-measurement-method.md). Box
memory floors come from measurements, not guesses. CPU boxes run where WSL2 runs; the GNINA driver
floor will be measured the way OpenMM's was
([decision](../../decisions/openmm-cuda-needs-the-cuda-12-9-driver.md)), not taken from CUDA's
minor-version table.

## Integration design

Every capability follows the existing Tool Runtime pattern, the one pVACseq and OpenMM use:

1. Box metadata in `packages/liatir-core/src/tool-runtime-catalog.ts`, entering
   `LIATIR_TOOL_RUNTIME_CATALOG` only once a target is published; until then it travels as a release
   candidate (`frontend/src/lib/runtime-box-release-candidate.ts`).
2. Typed contracts and validators in a `packages/liatir-core/src/<domain>.ts` module, plus new
   artifact profiles where a format is new (SDF small molecules and poses, the screening database,
   SBML, simulation time series).
3. Tool step definitions and one offline Python adapter per box under `frontend/src/lib/tools/`,
   run through `runToolRuntimePython`, with preflight before heavy imports.
4. Direct runs through the shared Tool Runtime finalizer; pipeline steps through
   `frontend/src/lib/tools/pipeline-registry.ts`.
5. Existing viewers where they fit (3D structure viewer for receptor plus pose; tables and plots for
   scores and time series). No new viewer framework.
6. A validator script per box (`scripts/validate-<box>-runtime.mjs`), a CI workflow modelled on
   `runtime-box-openmm.yml`, a catalog entry, a legal record, public docs under `docs/tools/`.

Target workflows:

```text
Protein + ligands -> Preparation -> Docking -> Screening database -> Results       (Phase 2)
Docked poses -> GNINA rescoring -> comparison with Vina                           (Phase 3, B1)
Docking -> selected complex -> OpenMM -> trajectory analysis (MDAnalysis, ProLIF)  (Phase 3)
Model -> simulation -> time series / fluxes / cell populations -> Results          (Phase 4)
```

A docking pose is not a parameterized system. The selected-complex step hands OpenMM the prepared
receptor plus the pose as an SDF with all hydrogens, and OpenMM's reviewed OpenFF path parameterizes
it or refuses it by name. Nothing approximates missing parameters.

## Phases and gates

Status categories, used only with evidence: IMPLEMENTED, SCIENTIFICALLY VALIDATED, PRODUCT
VALIDATED, RELEASE READY, PUBLISHED, BLOCKED.

### Phase 1 — Architecture and feasibility: complete (2026-11-03)

Accepted on: this plan; verified versions and licences; four resolved environments; box boundaries
decided; reference fixtures identified; blockers recorded.

### Phase 2 — Molecular preparation, docking and virtual screening

1. Scroll, lock, self-test, legal record and audit for `molecular-docking/linux-x86_64-cpu`.
2. Local development build in WSL2; self-test; size and install footprint.
3. Python adapter: receptor preparation (PDB/mmCIF; PDBFixer report and opt-in repairs; protonation
   pH; Meeko templates with every unmatched residue reported), ligand preparation (SDF; RDKit
   sanitization; stereo preserved; unsupported chemistry refused), binding site (explicit box or
   reference ligand plus padding, validated against receptor bounds), Vina docking (single and batch;
   exhaustiveness, seed, CPU limit, poses), pose export to SDF with all hydrogens, Ringtail ingestion,
   filtering, ranking and export.
4. Scientific validator on the built payload (below).
5. Product integration: contracts, artifact profiles, tools, pipeline steps, Results, provenance,
   viewer handoff, docs.
6. Product lifecycle in the real app (install, run, cancel, Results, uninstall) natively in WSL2 and
   on Windows through WSL2.
7. Release readiness: catalog, signer policy, CI workflow; publication only with explicit
   authorization (B3, B4).

### Phase 3 — Neural docking and molecular analysis

1. `molecular-analysis` box: MDAnalysis (DCD with matching topology, RMSD, RMSF, distances and
   contacts, PBC-aware where the topology has a box) and ProLIF (fingerprints, interaction frequency
   and persistence, for trajectories and docked poses).
2. Selected-complex step and the end-to-end Docking → OpenMM → analysis workflow, using trajectories
   from the published OpenMM box.
3. GNINA rescoring first, then optional refinement and docking, once B1 is resolved.

### Phase 4 — Biochemical, metabolic and multicellular simulation

4A PySB + BioNetGen, 4B COBRApy, 4C PhysiCell — each independently validated and releasable, in the
order 4B, 4A, 4C (increasing native-code risk).

## Scientific validation criteria

Acceptance thresholds come from the cited reference, never from a convenient number.

| Component | Reference | Acceptance |
| --- | --- | --- |
| Meeko/RDKit ligand prep | 1IEP imatinib SDF; official `1iep_ligand.pdbqt` | Same heavy atoms, element and formal-charge set, stereo preserved; atom types and torsion count equal to the official file |
| PDBFixer/Meeko receptor prep | 1IEP from the PDB, hashed | Missing atoms reported exactly; no residue, ligand, ion or water removed unless the user chose it; every change in provenance |
| Vina docking | Official 1IEP example, exhaustiveness 32 | Top-ranked pose heavy-atom RMSD ≤ 2.0 Å to the crystal imatinib (the standard redocking success criterion of Vina 1.2 and GNINA's evaluations); top score reported against the tutorial's −13.23 kcal/mol, with the run-to-run spread measured, not assumed |
| Score extraction | Vina `energies()` and the PDBQT `REMARK VINA RESULT` lines | Exact agreement |
| Reproducibility | Same seed, CPU count and build | Measured; claimed only as far as observed |
| Ringtail | Batch of the reference ligand plus controls | Every ligand present, counts exact, filters reproduce a direct query, exported SDF poses match stored poses, mismatched experiment refused |
| MDAnalysis | OpenMM box trajectories; an independent NumPy Kabsch RMSD | Agreement to floating-point tolerance; units (Å, ps) and frame times checked against OpenMM's state CSV |
| ProLIF | ProLIF's own tutorial data | Interactions reproduced as documented |
| PySB/BioNetGen | Robertson stiff system (Hairer and Wanner reference values); an analytically solvable birth–death process for SSA | ODE within solver tolerance of the reference; SSA mean and variance within statistical bounds of the analytical values |
| COBRApy | E. coli core (`textbook`) | FBA objective equal to COBRApy's documented 0.8739 h⁻¹ within solver tolerance; HiGHS and GLPK agree; FVA and single-gene deletions consistent across solvers |
| PhysiCell | Reviewed sample models | Invariants from the model's own parameters (e.g. growth rate implied by the cycle model), seeded single-thread reproducibility, output files parse |

Resource use, malformed and unsupported inputs, cancellation and provenance are validated for every
component.

## Blockers and risks

- **B1 — GNINA redistribution (BLOCKED, owner decision).** The official binary is GPL-2.0 as a
  whole and is distributed together with NVIDIA libraries. Before Liatir redistributes it, inspect
  what the binary links statically, establish whether the result can be distributed under GPL-2.0 at
  all, and choose a delivery mode from the workbench plan's list: a signed box with the binary and its
  complete corresponding source; a box that fetches the official binary from GitHub at install with a
  pinned SHA-256; or a user-supplied binary validated by digest. Download of the 2 GB binary is held
  until then. GNINA's work does not block anything else.
- **B2 — Native executables for PhysiCell (and optionally BioNetGen).** Scrollcase has no compile
  step and the upstream PhysiCell binaries need glibc ≥ 2.38. Candidate paths: a reproducible compile
  with conda-forge's toolchain (glibc 2.17 sysroot, portable `-march`, OpenMP) supplied as a hashed
  asset, or a pixi-build source package. Decide in Phase 4C, with the Scrollcase maintainer if the
  build needs a new Scrollcase feature.
- **B3 — Signer policy.** Each new box needs an entry in `services/runtime-box-signer/policy.json`
  and a signer redeploy before a production signature: a remote, authorized action.
- **B3 now applies on this branch**: `services/runtime-box-signer/policy.json` lists
  `molecular-docking`. Merging it into `main` makes the deployed signer stale for every box until
  `runtime-box-signer-deploy.yml` runs (`verify-signer-policy` compares the whole policy).
- **B4 — Publication.** Production releases run `runtime-box-release.yml` on this machine's
  self-hosted runner from `main`; merging, pushing and releasing each need the owner's explicit go.
- **R1 — Vina reproducibility** may depend on thread count; measure before claiming.
- **R2 — WSL2 memory** (12 GB) bounds the size of screens and trajectories accepted by preflight.

## Decisions

- **D1** — Runtime Box boundaries as tabled above.
- **D2** — Python 3.11 in every new box.
- **D3** — The docking box carries OpenMM 8.5.1 build `py311h6619805_0` with `cuda-version 12.9`,
  identical to the OpenMM box.
- **D4** — Vina runs through its official Python bindings (`vina.Vina`): no shell, explicit
  `cpu`, `seed` and `exhaustiveness`, energies read from the API.
- **D5** — A screening database belongs to one experiment: receptor PDBQT SHA-256, box centre and
  size, scoring function, exhaustiveness, Vina and Meeko versions. Liatir records that identity with
  the database and refuses appends that differ.
- **D6** — Redocking acceptance is the top-ranked pose within 2.0 Å heavy-atom RMSD of the crystal
  ligand; scores are reported as Vina scores in kcal/mol and never as measured affinities.
- **D7** — COBRApy solves with HiGHS by default; GLPK is the independent cross-check.
- **D8** — PySB executes only reviewed built-in models and declarative BNGL imported without actions.
- **D9** — PhysiCell runs reviewed executables on validated configurations; no user C++ is compiled.
- **D10** — GNINA starts with rescoring; docking and refinement follow only with validation.
- **D11** — Receptor Preparation re-protonates every residue at one pH with OpenMM's rules and
  replaces input hydrogens (finding 19); bring a receptor protonated elsewhere as its own PDBQT.
- **D12** — Chains are always author chains; residues without a bundled Meeko template are refused
  by name before any repair (findings 17, 18).
- **D13** — The docking box's memory floor is 4 GB, from a measured peak under 1 GB; the scroll and
  the release-candidate metadata carry the same value, as the installer requires.
- **D14** — The public Molecular Docking page under `docs/tools/` and its Tools-overview row are
  written in the publication commit, as for OpenMM, so the site never offers an uninstallable tool.

## Component status

| Component | Status | Evidence |
| --- | --- | --- |
| Vina, RDKit, Meeko, PDBFixer, Ringtail | SCIENTIFICALLY VALIDATED and PRODUCT VALIDATED on native Linux (development build); Windows through WSL2 and publication pending | `runtime-boxes/measurements/molecular-docking-linux-x86_64-cpu-development-2026-11-03.json`, `runtime-boxes/measurements/molecular-docking-linux-x86_64-cpu-product-lifecycle-development-2026-11-03.json` |
| GNINA | BLOCKED (B1) | finding 8 |
| MDAnalysis, ProLIF | not started | resolves (finding 9) |
| PySB, BioNetGen | not started | resolves (finding 10) |
| COBRApy | not started | resolves (finding 11) |
| PhysiCell | not started; B2 open | finding 12 |

## Phase 2 evidence (development build, 2026-11-03)

Box `molecular-docking` `1.2.7-beta.1` / `linux-x86_64-cpu`, lock `271965e6…`, 152 packages,
signed with the WSL2 development key: archive `5a3a9521…`, 591,761,185 bytes, installed 1.65 GB; the
only prune is the `lib/python3.1` copy of finding 13 (an earlier build that also pruned the GPU plugins
and NVIDIA libraries was 1.03 GB, but broke the rule that a packed conda prefix ships whole). The
validator `scripts/validate-molecular-docking-runtime.mjs` ran the product's own adapter in the
signed, extracted payload on this host (Intel i7-8700K, 6 vCPU, 12 GB): **18 cases, all passed**,
record `runtime-boxes/measurements/molecular-docking-linux-x86_64-cpu-development-2026-11-03.json`.

| Case | Result |
| --- | --- |
| Redock, official receptor PDBQT, exhaustiveness 32 | top pose 0.368 Å, -13.219 kcal/mol (tutorial: −13.234) |
| Redock, receptor prepared here from the official PDB | top pose 0.369 Å, -13.211 kcal/mol |
| Redock, receptor prepared from the raw PDB entry 1IEP | top pose 0.374 Å, -13.306 kcal/mol |
| Ligand typing against the official `1iep_ligand.pdbqt` | identical atom types and torsion count |
| Same seed and threads, twice | identical poses: yes |
| Same seed, 1 thread against 6 | identical poses: yes |
| Screen of 9 molecules | 6 docked, 3 refused by name (2D input, salt, boron) |
| Database guards | same-experiment append accepted; another site and a foreign database refused |
| Malformed inputs | truncated SDF, ligand as receptor, 200 Å box, mismatched receptor PDB refused |

**Real-app lifecycle, native Linux (WSL2, Xvfb), 2026-11-03: 2 of 2 passed** —
`runtime-box-release-candidate.e2e.mjs` and `runtime-box-molecular-docking-native.e2e.mjs` on a test
binary built with the docking candidate, against the loopback registry and the development key. The box
(`eb299933…`, 591,761,187 bytes, 1,515,487,168 installed; the same lock and files as the validated
build, which differs only in the builder revision its provenance records) installed with signature
verification; a killed Job reached `killed`; Receptor Preparation and Molecular Docking ran through
their pages inside the measured envelope; imatinib redocked at **0.247 Å, −13.368 kcal/mol** (default
exhaustiveness 8, box around the crystal ligand); Jobs, Results, provenance and the interpretation
notice held; removal kept every Result file. Record `runtime-boxes/measurements/molecular-docking-linux-x86_64-cpu-product-lifecycle-development-2026-11-03.json`. Two test-only defects were fixed on the way:
the release-candidate spec had no route for the docking candidate, and the picker helper matched the
already-filled Ligands field (the reference ligand now has its own file name). `runtime-boxes/README.md`
told local builds to pass `--asset-base-url`, which Scrollcase 1.4.0 does not have; the archive URL
comes from `--publish-base-url`, now documented.

Peak memory over every case 1.25 GB (process-tree PSS, finding 16); slowest case batch-screen,
103 s. The 2.0 Å threshold is the standard redocking success criterion (D6); scores
are reported, never treated as affinities.

## Progress log

- 2026-11-03 — Phase 1. Context read; WSL2 host and toolchain measured; Linux checkout brought to
  `18f77616` on branch `simulation-suite`; upstream versions and licences verified; four
  environments resolved; PhysiCell and BioNetGen binaries inspected without being executed; this plan,
  the boundary decision and the context links written. No build, download beyond 16 MB of upstream
  release files, push, CI or paid action.
- 2026-11-03 — Phase 2. Docking box recipe committed (`5252d7a2`); development build in WSL2;
  adapter, shared contract, release-candidate metadata, tools, pipeline steps, restart finalizer,
  Receptor Preparation and Molecular Docking pages, unit tests (13), validator, catalog entry,
  signer-policy entry, CI workflow and release option written; findings 13–19 recorded; SDK types
  regenerated; core build, frontend check (0 errors) and catalog check pass.

## For the owner

- **Every published Linux Python box ships its Python library twice** (finding 13): about 1.1 GB of
  OpenMM's 3.7 GB install. Fixing it belongs in Scrollcase (keep or drop in-tree directory links
  instead of copying them) and then needs a republish of each box; the docking box already avoids it
  with a prune.

## Next concrete actions

1. `npm run test:verify` on the branch; the Windows-through-WSL2 lifecycle with a Windows test app
   built with the same candidate (the only build outside WSL2 the plan allows: the product shell, not
   a scientific component).
2. Production release (B3, B4): merge, signer redeploy, `runtime-box-release.yml` with
   `model_id=autodock-vina-molecular-docking`, `target_id=linux-x86_64-cpu`, `channel=beta`; then the
   publication commit (catalog, product catalog, docs, measurement from the production build).
3. Phase 3: the `molecular-analysis` box (MDAnalysis, ProLIF).
