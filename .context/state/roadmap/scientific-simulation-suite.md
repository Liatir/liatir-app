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
20. **RDKit leaves an unnamed molecule's SDF title line blank**, and the docking preflight trimmed
    blank lines from the start of each record, so it read the program line as the counts line and
    refused every unnamed molecule ("unreadable counts line"). Found while reading ProLIF's own Vina
    poses for Phase 3; records are now split only at their `$$$$` terminators and never trimmed, and
    a unit test holds it.
21. **Calling a ProLIF interaction returns a generator, which is always truthy**, so
    `assert fingerprint.hbdonor(a, b)` passes whether or not the bond exists. The box self-test first
    did exactly that; adding ProLIF's own negative control (`acceptor_false.mol2`) exposed it.
    Interactions are tested with `Interaction.any`, which returns `True` or `None`, as ProLIF's test
    suite does with `next(..., False)`.
22. **MDAnalysis caches an XTC file's frame offsets in hidden files beside the path it opens**
    (`.name_offsets.npz` and a `.lock`), and `refresh_offsets=True` still writes them. The build
    self-test therefore baked two cache files into the signed archive, and the first validator run
    rewrote one, so the payload no longer matched its signature. In the product it would have written
    beside every user's trajectory. The runner and the self-test now open a trajectory through a link
    in a temporary directory; the validator re-verifies the signed payload after every run and the
    lifecycle spec checks that the user's data directory is unchanged.
23. **MDAnalysis's distance rule is not a reliable source of protein bonds.** It bonds two sulfurs
    only below 1.98 Å, so it missed the 2.03 Å disulfide in ProLIF's trajectory, and on the
    unrelaxed receptor PDBFixer writes it bonded a Met290 methyl hydrogen to the sulfur 1.47 Å away
    (found by the chain validator; the hydrogen-valence guard refused the run). RDKit's PDB proximity
    bonding reproduces OpenMM's residue templates exactly — 4,470 of 4,470 bonds on that receptor and
    on OpenMM's 61,538-atom trajectory topology, 5,053 of 5,053 on both ProLIF structures — so the
    runner takes protein bonds from RDKit, and keeps the guard.
24. **OpenMM numbers residues past 9999 in hybrid-36** (`A000`) in the PDB topology of a large
    solvated system. That is valid PDB, but RDKit's reader refuses the file and MDAnalysis reads those
    residue numbers as 1. The runner gives RDKit only the protein's records; selecting solvent by
    residue number in such a topology is unreliable (limitation L2).
25. **A bifurcated hydrogen bond is one hydrogen bond to a geometric rule.** Nagar et al. describe
    imatinib's piperazinium NH bonding the Ile360 and His361 carbonyls; it has one hydrogen, and
    ProLIF's donor-angle criterion assigns it to Ile360 (2.67 Å) and records His361 (3.19 Å) as a van
    der Waals contact. The chain validator holds the five hydrogen bonds a single-hydrogen rule can
    see, plus that contact.
26. **COBRApy reaches HiGHS only through optlang's hybrid interface**, which also needs OSQP: COBRApy
    0.32.1 does not know a solver called `highs`, and `hybrid` exists only once `osqp` (Apache-2.0) is
    installed. The box adds OSQP 1.1.3; HiGHS solves the linear problems.
27. **COBRApy creates `~/.cache/cobrapy` when it is imported**, in the user's home. The runner points
    `XDG_CACHE_HOME` at a temporary directory before importing it. Scrollcase imports a box's listed
    modules before its self-test code runs, so COBRApy is left off that list.
28. **HiGHS returns the same solution on every run, but its last bits vary by about 1e-14**; GLPK is
    bit-identical. Reproducibility is held to the precision the runner reports (nine significant
    digits, values below 1e-9 written as zero), not to identical bytes.
29. **Two floating-point solvers can disagree where a problem is degenerate.** At 100 % of the optimum
    on iJO1366, GLPK let OPHHX3 carry 2.2e-4 where HiGHS found 1e-10; GLPK's exact rational simplex
    gives 0. The runner settles any value the two disagree on in exact arithmetic (at most 200 per run,
    otherwise it refuses) and reports which; a value exact arithmetic does not confirm is refused.
30. **PySB 1.17.0 imports `dateutil` without declaring it**; the box adds `python-dateutil`.
31. **BioNetGen's release archive has two top-level entries and 167 macOS resource forks** (`._*`).
    Scrollcase refuses `stripComponents` on an archive with more than one root, so it is unpacked whole
    under `bionetgen-release/` and the forks are pruned by exact path. The directory cannot be called
    `bionetgen`: at the box root it answers `import bionetgen` as a namespace package, and PySB's
    BioNetGen lookup then fails (`module 'bionetgen' has no attribute 'defaults'`).
32. **PySB's defaults would compile and resolve names.** `ScipyOdeSimulator` integrates with VODE and
    compiles the right-hand side with Cython; the runner uses LSODA with a Python right-hand side, so
    nothing is compiled on the user's computer. PySB's logger calls `socket.getfqdn()`, a reverse DNS
    lookup that failed every offline run until the runner answered it locally.
33. **PySB's `BngSimulator` gives every stochastic replicate the same seed**, so a request for many
    runs returns copies of one. The runner runs each replicate with its own seed (seed + i) in one
    BioNetGen session; the same seeds reproduce byte-identical runs.
34. **BioNetGen ends network generation without a word.** At `max_iter` it returns the network as it
    stood; with `max_agg` it drops every larger complex; and it has no limit on memory or time — a
    one-rule linear polymer ran 72 minutes before it was stopped by hand. The runner never sets
    `max_agg`, refuses a network still growing in its last permitted round (100), and runs BioNetGen
    under limits it inherits: 4 GB of address space and 5 minutes of CPU time. A model past either is
    refused, never simulated on a partial network.
35. **The network, not the rule set, is the cost**: one rule can define an infinite network. The
    preflight therefore generates the network, and the measured envelope is matched on species and
    reactions; the run generates it again and must obtain the same network (same SHA-256).
36. **PySB 1.17.0 imports, and BioNetGen generates within seconds, 18 of the 27 example models
    BioNetGen 2.9.3 ships** (the largest, `egfr_net`, 356 species and 3,749 reactions in 5.8 s). PySB's
    importer refuses 6 (Arrhenius and saturation rate laws, exclude-reactant declarations), one file
    has no rules, and two (`blbr`, `tlbr`) are written for network-free simulation and never close.
37. **Scrollcase 1.4.0 cannot give a file unpacked from `assetArchives` the executable bit.** The
    archive's modes are synthesised from declarations — `assets[].executable`, `localFiles[].executable`
    and the runtime's `venv/bin` rule — and an archive member has none, so BioNetGen's `BNG2.pl` and
    `bin/run_network` install as 0644 and PySB refuses to start BioNetGen. The box self-test and the
    validator both ran on the build directory, where extraction had kept the bits; only the real-app
    lifecycle, installing the signed archive, saw it. A validator must run on the payload as a consumer
    extracts it. See B5.
38. **PhysiCell 1.14.2 builds portably and reproducibly with conda-forge's toolchain** (gcc 15.3.0,
    glibc 2.17 sysroot, `-march=x86-64-v2`, OpenMP). `runtime-boxes/native-builds/physicell/build.sh`
    compiles the template project from the reviewed release archive, links the GCC runtime and
    OpenMP in, and checks what it made: the executable (2,544,576 bytes, SHA-256 `2dd954ad…`) needs
    glibc 2.17 at most (the upstream ones need 2.38), no `GLIBCXX` symbol and no library but glibc's.
    Two builds, each with the toolchain installed under a different temporary path, are
    byte-identical. conda-forge's compiler writes its library directory into every dynamic executable
    as RPATH, and `patchelf --remove-rpath` leaves the path in the string table, so the build links
    with a copy of the compiler's specs without that clause. pixi does not run the compiler packages'
    activation scripts, so the compiler is named by path; PhysiCell's Makefile ignores failed
    commands, so the build reads its log.
39. **PhysiCell builds shell commands from paths in its settings.** `main.cpp` copies the settings
    file with `system("cp <argv[1]> <save folder>")`, and `PhysiCell_utilities.cpp` copies the rules
    and cell files the same way, so a settings file naming a folder `output; <command>` would run the
    command. The runner never runs a user's settings as written: it writes the settings PhysiCell runs,
    with its own relative paths and run controls, and copies the user's CSV files itself. The validator
    runs such a hostile settings file and checks that no command ran.
40. **PhysiCell 1.14.2 crashes when a simulation starts without cells** (segmentation fault, with or
    without substrates), though a population that dies out during a run carries on. The runner
    refuses settings that start no cell.
41. **Scrollcase's self-test runs on the build directory, where a downloaded executable has no mode**,
    while the archive marks it executable from the scroll's declaration: finding 37 in reverse. The
    PhysiCell self-test runs a copy; the box was validated as unpacked from its signed archive. See B5.

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
- **B2 — A portable PhysiCell executable.** Resolved for development (finding 38): the recipe and its
  toolchain lock are in `runtime-boxes/native-builds/physicell/`, and the executable is a reviewed
  source mirror (`physicell-1-14-2-template` in the Registry worker and the distribution CLI). A
  production release needs it uploaded by `runtime-box-physicell-source-mirror.yml`, a manual workflow
  that rebuilds it and uploads only the reviewed bytes, after a Registry deploy that knows the
  mirror: both are the owner's go. The original note follows. Packaging is not the problem: Scrollcase boxes carry
  and start compiled binaries (its `native` runtime; a binary supplied as a hashed asset, with what is
  linked inside it declared in a `bundledLicenseDeclaration`), as BioNetGen's executables show here.
  Scrollcase does not compile source, and PhysiCell has no usable binary: it is on no conda channel,
  and the upstream executables need glibc ≥ 2.38 (finding 12). The path: compile the pinned
  PhysiCell source with conda-forge's toolchain (glibc 2.17 sysroot, portable `-march`, OpenMP) from a
  recipe and toolchain lock kept in this repository, so the bytes can be rebuilt and compared, and
  supply the result as a hashed asset. Development builds can serve it locally (an asset URL is any
  URL); a production release needs it at an immutable public URL, a publishing action that needs
  the owner's go. Owner clarification, 2026-11-04: Scrollcase supports native runtimes, so no
  Scrollcase feature is needed.
- **B5 — Executable files inside an expanded asset archive.** Scrollcase has no declaration for them
  (finding 37), so Biochemical Simulation cannot start BioNetGen once installed. Recommended fix, in
  Scrollcase: `assetArchives[].executables` (paths below `destination`, checked to exist after
  extraction) feeding the same synthesised modes, and a self-test that runs on those modes rather
  than on the build directory's. Scrollcase is the owner's project and its release is theirs; the
  alternative inside 1.4.0 — unpacking BioNetGen under `venv/bin`, which the runtime marks executable
  wholesale — puts Perl modules and models among the box's programs and is not taken.
- **B3 — Signer policy.** Each new box needs an entry in `services/runtime-box-signer/policy.json`
  and a signer redeploy before a production signature: a remote, authorized action.
- **B3 now applies on this branch**: `services/runtime-box-signer/policy.json` lists
  `molecular-docking`, `molecular-analysis` and `metabolic-modeling`. Merging it into `main` makes the deployed signer stale for every box until
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
| MDAnalysis, ProLIF | SCIENTIFICALLY VALIDATED and PRODUCT VALIDATED on native Linux (development build); Windows through WSL2 and publication pending | `runtime-boxes/measurements/molecular-analysis-linux-x86_64-cpu-development-2026-11-04.json`, `runtime-boxes/measurements/molecular-analysis-linux-x86_64-cpu-product-lifecycle-development-2026-11-04.json` |
| Docked Complex (docking box) | SCIENTIFICALLY VALIDATED and PRODUCT VALIDATED on native Linux (development build); Windows through WSL2 and publication pending | `runtime-boxes/measurements/molecular-docking-linux-x86_64-cpu-development-2026-11-04.json`, `runtime-boxes/measurements/docking-simulation-chain-development-2026-11-04.json` |
| PySB, BioNetGen | SCIENTIFICALLY VALIDATED on the development build's directory; the installed box cannot start BioNetGen (B5) | `runtime-boxes/measurements/biochemical-simulation-linux-x86_64-cpu-development-2026-11-04.json` |
| COBRApy | SCIENTIFICALLY VALIDATED and PRODUCT VALIDATED on native Linux (development build); Windows through WSL2 and publication pending | `runtime-boxes/measurements/metabolic-modeling-linux-x86_64-cpu-development-2026-11-04.json`, `runtime-boxes/measurements/metabolic-modeling-linux-x86_64-cpu-product-lifecycle-development-2026-11-04.json` |
| PhysiCell | SCIENTIFICALLY VALIDATED and PRODUCT VALIDATED on native Linux (development build, validated as unpacked from its signed archive); production needs the source mirror (B2), then Windows through WSL2 and publication | `runtime-boxes/measurements/physicell-linux-x86_64-cpu-development-2026-11-04.json` |

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

## Phase 3 evidence (development build, 2026-11-04)

Box `molecular-analysis` `2.11.0-beta.1` / `linux-x86_64-cpu`, lock `6badab47…`, 188 packages,
Python 3.11.18, signed with the WSL2 development key: archive `2c975cdb…`, 316,696,256 bytes,
installed 1,116,869,916 bytes; no cache file in the archive (finding 22). The validator
`scripts/validate-molecular-analysis-runtime.mjs` ran the product's own runner in the signed, extracted
payload: 10 measured runs and 12 refusals passed, with ProLIF's vectors, the agreement checks and the
payload re-verification, record
`runtime-boxes/measurements/molecular-analysis-linux-x86_64-cpu-development-2026-11-04.json`.

| Check | Result |
| --- | --- |
| RMSD, RMSF, minimum and centroid distances against an independent NumPy computation (unwrapping recurrence, Kabsch by SVD, minimum image) | max difference 5.0 × 10⁻⁵ Å on XTC and on the same frames as DCD; strided window equal |
| ProLIF's 61 official interaction test vectors, loaded as its `conftest.py` loads them | 61 of 61 |
| Runner against ProLIF run directly | identical: 5,076 trajectory rows, 159 pose rows; ProLIF's pinned anchors present |
| Protein bonds derived for a PDB without them, against recorded bonds | identical, 5,053 of 5,053, on both reference structures (finding 23) |
| A trajectory from the OpenMM box (61,538 atoms, 50 frames, checked against its state record) | analysed in 1.5 s, fingerprinted in 31 s |
| Reproducibility | the same request twice gives byte-identical tables |
| Signed payload after every run | re-verified unchanged |
| Refusals | mismatched topology, truncated XTC and DCD, non-finite frame, empty and invalid selections, frame range beyond the trajectory, ligand without bond records, ligand not the reference molecule, receptor or poses without hydrogens, unknown interaction |

Peak memory 282 MB; slowest case the 250-frame fingerprint of ProLIF's trajectory, about 200 s. Reference data is
ProLIF 2.2.3's packaged trajectory, Vina poses and interaction test molecules (Apache-2.0).

**Real-app lifecycle, native Linux (WSL2, Xvfb), 2026-11-04: 2 of 2 passed** — Trajectory Analysis
and Interaction Fingerprint through their pages on ProLIF's trajectory copied into the user's Data,
inside the measured envelope: protein Cα and ligand RMSD reported, ProLIF's pinned frame-0
interactions (VAL201.A and PHE351.B hydrophobic) found, the user's data directory unchanged
(finding 22), Jobs, Results, provenance, the offline boundary and removal held. Record
`runtime-boxes/measurements/molecular-analysis-linux-x86_64-cpu-product-lifecycle-development-2026-11-04.json`. The spec cleared fields through a WebDriver call the
harness does not have; it now uses `setAppInputValue`.

## Docking → OpenMM → analysis chain (development builds, 2026-11-04)

`scripts/validate-docking-simulation-chain.mjs` runs each product runner in its own box on the official
1IEP example: Receptor Preparation, redocking at exhaustiveness 32, Docked Complex, OpenMM, Trajectory
Analysis and Interaction Fingerprint. **Passed**, record
`runtime-boxes/measurements/docking-simulation-chain-development-2026-11-04.json`.

| Step | Result |
| --- | --- |
| Redocking | −13.211 kcal/mol; the selected pose is 0.369 Å from the crystal |
| Docked Complex | receptor 4,411 atoms + imatinib 69 atoms with its bonds, chain L |
| Crystal pose fingerprint | Met318, Thr315, Glu286, Asp381 and Ile360 hydrogen bonds, His361 contact (finding 25); the docked pose recovers four |
| OpenMM (published `linux-x86_64-cuda12.9` payload, RTX 4060 Ti) | the complex in TIP3P-FB water at 1 bar, OpenFF 2.3.0 ligand with NAGL charges: 61,538 atoms, 100 ps, 50 frames |
| Binding mode | hinge contact (imatinib to Met318 N) 2.71–3.21 Å in every frame, criterion ≤ 3.5 Å; protein Cα RMSD mean 1.13 Å, ligand mean 1.43 Å |
| Hydrogen-bond persistence | Met318 100 %, Glu286 88 %, Thr315 82 %, Asp381 68 %, Ile360 2 % |
| Ligand identity | the molecule read back from the trajectory is the docked imatinib (protonated piperazine) |

A first run measured the ligand's RMSD to 2.34 Å and failed a ≤ 2 Å threshold borrowed from
redocking; the excursions were the solvent-exposed methylpiperazine (up to 4.2 Å) while the core
moved under 0.5 Å. The binding mode is now held by the hinge contact, and ligand RMSD is reported.

The docking validator was rerun with Docked Complex: 21 cases passed, including a pose docked into
another receptor and an absent pose refused; record
`runtime-boxes/measurements/molecular-docking-linux-x86_64-cpu-development-2026-11-04.json`, which the
docking envelope now cites.

**Docked Complex real-app lifecycle, native Linux (WSL2, Xvfb), 2026-11-04: 2 of 2 passed** — the
docking spec now continues past redocking: the top pose (0.247 Å from the crystal, −13.368 kcal/mol)
with the receptor it was docked into, through the Docked Complex page inside the measured envelope,
gives a complex of 4411 receptor and 69 ligand atoms with the same score, and every Result of the three
tools survives the box's removal. Record `runtime-boxes/measurements/molecular-docking-linux-x86_64-cpu-product-lifecycle-development-2026-11-04.json`.

## Phase 4B evidence (development build, 2026-11-04)

Box `metabolic-modeling` `0.32.1-beta.1` / `linux-x86_64-cpu`, lock `66e2fabe…`, 95 packages: COBRApy
0.32.1, optlang 1.9.1, HiGHS 1.15.1 (default solver), OSQP 1.1.3, GLPK 5.0 (cross-check), libSBML
5.21.2, Python 3.11.18. Signed with the WSL2 development key: archive `f64a1fd8…`, 208.6 MB,
installed 715 MB. The validator `scripts/validate-metabolic-modeling-runtime.mjs` ran the product's
runner in the signed payload, every run confirmed by GLPK: **passed**, record `runtime-boxes/measurements/metabolic-modeling-linux-x86_64-cpu-development-2026-11-04.json`.

| Check | Reference | Result |
| --- | --- | --- |
| FBA, E. coli core (`textbook`) | COBRApy's documented 0.8739215069684307 | within 1e-9; SBML and COBRA JSON equal |
| FVA, all 95 reactions | COBRApy 0.32.1 `tests/data/textbook_fva.json` | every value within np.allclose |
| Repeated FVA | — | agrees within 0.0e+00 |
| Single gene deletions | COBRApy's 7 essential genes and 5 pinned growth values | identical set, values within 0.01 |
| Single reaction deletions | COBRApy's 18 essential reactions and 6 pinned values | identical set, values within 1e-5 |
| Minimized glucose uptake at 95 % of the optimum | COBRApy's test: −10 to −9.5 | exact |
| iJO1366 (2,583 reactions, 1,367 genes) | HiGHS against GLPK | FBA 0.98237181; FVA 579 s with 1 value settled in exact arithmetic for HiGHS (finding 29); gene deletions 176 s, 208 essential |
| Refusals | — | no glucose (infeasible), unknown reaction, gene or objective, inverted bounds, DOCTYPE/ENTITY, truncated gzip, non-SBML XML, non-model JSON, gene deletion without gene products, MATLAB format |
| Nothing written outside the run | — | the home directory stays empty; the signed payload re-verifies |

Peak memory 547 MB. Reference data ships in COBRApy; the FVA table is committed as
`runtime-boxes/fixtures/metabolic/cobrapy-0.32.1-textbook-fva.json`.

**Real-app lifecycle, native Linux (WSL2, Xvfb), 2026-11-04: 2 of 2 passed** —
`runtime-box-release-candidate.e2e.mjs` and `runtime-box-metabolic-modeling-native.e2e.mjs` on a test
binary built with the metabolic candidate, against the loopback registry and the development key. The
box installed with signature verification; a killed Job reached `killed`; FBA on E. coli core ran
through the page inside the measured envelope at 0.8739215069684303 (documented 0.8739215069684307),
confirmed by GLPK; single gene deletions found COBRApy's 7 essential genes; Jobs, Results, provenance,
the offline boundary and the interpretation notice held; removal kept every Result file. Record
`runtime-boxes/measurements/metabolic-modeling-linux-x86_64-cpu-product-lifecycle-development-2026-11-04.json`. Two test-only
defects were fixed on the way: the spec chose a dropdown value through a WebDriver call the harness
does not have (it now uses `setAppInputValue`), and the file-picker helper clicked the run-history entry
named after the same input file (the picker popup is now a labelled `role="dialog"`, and the helper
looks only inside it).

## Phase 4A evidence (development build, 2026-11-04)

Box `biochemical-simulation` `1.17.0-beta.1` / `linux-x86_64-cpu`, lock `a7e83046…`, 43 packages: PySB
1.17.0 (PyPI wheel), BioNetGen 2.9.3 (official Linux release, `NFsim` pruned), Perl 5.44.0, SymPy
1.11.1, SciPy 1.17.1, Python 3.11.18. Signed with the WSL2 development key: archive `bf5ade96…`,
136.7 MB, installed 478 MB. The validator `scripts/validate-biochemical-simulation-runtime.mjs` ran the
product's runner in the signed payload: **passed**, 696 s, record
`runtime-boxes/measurements/biochemical-simulation-linux-x86_64-cpu-development-2026-11-04.json`.

| Check | Reference | Result |
| --- | --- | --- |
| Robertson's stiff problem to t = 10¹¹, LSODA | Test Set for IVP Solvers (Mazzia and Magherini), problem ROBER | relative error ≤ 3.6 × 10⁻¹⁰ |
| Synthesis and degradation, a parameter changed | exact solution A(t) = 20 − 19e^(−0.1t) | within 8.1 × 10⁻⁸ |
| The same model, 1,000 stochastic runs (Gillespie, BioNetGen) | stationary Poisson, mean and variance 10 | mean 9.848 (bound ±0.4), variance 9.95 (bound ±1.83); 1,000 distinct runs; the same seeds repeat byte for byte |
| BioNetGen's `egfr_net` (356 species, 3,749 reactions) | BioNetGen's own CVODE on the same network | LSODA within 2.0 × 10⁻⁸ (relative to each observable's range) |
| A BNGL file with `writeXML`/`writeSBML` actions | — | imported and simulated; no action ran |
| Every reviewed built-in PySB model | — | all eight generate a network (2 to 58 species) |
| Preflight against run | — | the same network, SHA-256 equal, in every case |
| Refusals | — | a linear polymer and BioNetGen's TLBR stopped at the 5-minute CPU limit; Arrhenius rate law, malformed BNGL, unknown built-in model or parameter, seed overflow, log-spaced stochastic run |
| Nothing written outside the run | — | the home directory stays empty; the signed payload re-verifies |

Peak memory 166 MB (process tree). The stochastic envelope is measured on synthesis and degradation
only, so a stochastic run of a larger network asks the user to confirm a run beyond evidence.

## Phase 4C evidence (development build, 2026-11-04)

Box `physicell` `1.14.2-beta.1` / `linux-x86_64-cpu`, lock `d569499b…`, 32 packages: Python 3.11.18,
NumPy 2.4.6, SciPy 1.17.1, and the PhysiCell 1.14.2 template executable from the native build
(finding 38), served on the loopback interface for this development build. Signed with the WSL2
development key: archive `720839ad…`, 109.0 MB, installed 345 MB. The validator
`scripts/validate-physicell-runtime.mjs` ran the product's runner in the payload unpacked from the
signed archive with the archive's own modes (finding 37): **passed**, record `runtime-boxes/measurements/physicell-linux-x86_64-cpu-development-2026-11-04.json`.

| Check | Reference | Result |
| --- | --- | --- |
| Fixed 600-minute cycles, 50 cells | the cycle model's own durations: 50 · 2^floor(t/600) | exact at all 41 times checked |
| Stochastic division at 1/600 per minute, 1,000 cells, 100 phenotype steps | Galton-Watson mean and variance for exit probability rate · dt | 2637 cells; expected 2704.8 ± 268.9 (4 SD) |
| Apoptosis at 1/600 per minute, no division | binomial survival | 367 alive; expected 366.0 ± 60.9 (4 SD) |
| A uniform substrate decaying at 0.001 per minute (BioFVM) | e^(−λt) | relative error ≤ 2.4e-06; the field stays uniform |
| PhysiCell's template, seed 1, one thread, twice | — | identical cell, population and substrate tables; seed 2 differs |
| A settings file with shell metacharacters in its paths (finding 39) | — | ran; no command executed; the run's settings hold Liatir's paths |
| Refusals | — | entities, intracellular models, `.mat` initial conditions, a 4-million-voxel domain, rules without their CSV, no starting cell (finding 40), seed and thread overflow, an unknown model source |
| Nothing written outside the run | — | the home directory stays empty; the signed payload re-verifies |

Peak memory 62 MB; slowest case fixed-cycle-doubling, 87 s.

**Real-app lifecycle, native Linux (WSL2, Xvfb), 2026-11-04: 2 of 2 passed** on the first run — the
box installed with the executable runnable as declared; a killed Job reached `killed`; PhysiCell's
template ran for a simulated day and the fixed-cycle settings, read from the user's Data, doubled
exactly on schedule at all 41 times checked, both inside the measured envelope; Jobs, Results,
provenance, the offline boundary and the interpretation notice held; removal kept every Result file.
Record `runtime-boxes/measurements/physicell-linux-x86_64-cpu-product-lifecycle-development-2026-11-04.json`.

## Progress log

- 2026-11-03 — Phase 1. Context read; WSL2 host and toolchain measured; Linux checkout brought to
  `18f77616` on branch `simulation-suite`; upstream versions and licences verified; four
  environments resolved; PhysiCell and BioNetGen binaries inspected without being executed; this plan,
  the boundary decision and the context links written. No build, download beyond 16 MB of upstream
  release files, push, CI or paid action.
- 2026-11-03 — `npm run test:verify` on the branch at `d89efb32`, in WSL2: all seven suites passed,
  94 files / 734 tests (7 skipped), report `2026-11-03T21-10-26-798Z`.
- 2026-11-03 — Phase 2. Docking box recipe committed (`5252d7a2`); development build in WSL2;
  adapter, shared contract, release-candidate metadata, tools, pipeline steps, restart finalizer,
  Receptor Preparation and Molecular Docking pages, unit tests (13), validator, catalog entry,
  signer-policy entry, CI workflow and release option written; findings 13–19 recorded; SDK types
  regenerated; core build, frontend check (0 errors) and catalog check pass.
- 2026-11-04 — The host rebooted unexpectedly at 09:12 (bugcheck 0x1E, in-page error); the last agent
  process had ended at 23:05 the day before, so no run was interrupted. Phase 3: analysis box recipe
  committed (`34ba9f57`); runner (trajectory measures, interaction fingerprints for trajectories and
  docked poses), shared contract, release-candidate metadata, Trajectory Analysis and Interaction
  Fingerprint pages and pipeline steps, restart finalizers, unit tests (13), validator, lifecycle spec,
  catalog entry, signer-policy entry, CI workflow and release option written; Docked Complex added to
  the docking runner, page and pipeline; findings 20–23 recorded; validator passed (above).
- 2026-11-04 — Docking validator rerun with Docked Complex (21 cases); the chain validator written and
  passed on the GPU; findings 23–25; analysis validator rerun with the OpenMM trajectory (10 measured
  runs). Phase 4B started: COBRApy feasibility, references and recipe.
- 2026-11-04 — Phase 4B: metabolic box built and validated (above); runner, contract, release
  candidate, Metabolic Modeling page and pipeline step, restart finalizer, unit tests, lifecycle spec,
  catalog and signer-policy entries, CI workflow and release option; findings 26–29.
- 2026-11-04 — Phase 4A: biochemical box built and validated (above). A one-rule polymer kept
  BioNetGen running for 72 minutes (finding 34); a survey of BioNetGen's 27 example models set the
  limits (finding 36). Runner, contract, release candidate, Biochemical Simulation page and pipeline
  step, restart finalizer, unit tests, lifecycle spec, catalog and signer-policy entries, CI workflow
  and release option; findings 30–36.
- 2026-11-04 — Real-app lifecycles passed on native Linux for Metabolic Modeling, the analysis tools
  and Docked Complex; Biochemical Simulation's found finding 37 (B5). Phase 4C: PhysiCell's native
  build recipe, box, runner, contract, release candidate, Multicellular Simulation page and pipeline
  step, restart finalizer, unit tests, lifecycle spec, catalog and signer-policy entries, CI workflow,
  release option and source-mirror workflow; validated (above); findings 38–41.

## For the owner

- **Every published Linux Python box ships its Python library twice** (finding 13): about 1.1 GB of
  OpenMM's 3.7 GB install. Fixing it belongs in Scrollcase (keep or drop in-tree directory links
  instead of copying them) and then needs a republish of each box; the docking box already avoids it
  with a prune.

## Next concrete actions

0. **Before the suite closes, discuss B1 (GNINA's redistribution) with the owner** — their request
   of 2026-11-04. GNINA stays blocked until then; nothing about it is decided by default.

1. The Windows-through-WSL2 lifecycle with a Windows test app built with the same candidate (the
   only build outside WSL2 the plan allows: the product shell, not a scientific component).
2. Production release (B3, B4): merge, signer redeploy, `runtime-box-release.yml` with
   `model_id=autodock-vina-molecular-docking`, `target_id=linux-x86_64-cpu`, `channel=beta`; then the
   publication commit (catalog, product catalog, docs, measurement from the production build).
3. Real-app lifecycle of every tool through WSL2 with item 1 (all pass on native Linux except
   Biochemical Simulation, B5).
4. Real-app lifecycle of Biochemical Simulation, once B5 is resolved.
5. The PhysiCell source mirror and its Registry deploy, with the production release (B2, B4).
