# Simulation suite Runtime Box boundaries

Taken 2026-11-03, in Phase 1 of the [Scientific Simulation Suite](../state/roadmap/scientific-simulation-suite.md).

## Decision

The eleven requested packages ship in six Runtime Boxes, each a Linux target serving Windows through
WSL2:

| Box | Contents | Target |
| --- | --- | --- |
| `molecular-docking` | AutoDock Vina, RDKit, Meeko, PDBFixer with the OpenMM library, Ringtail | `linux-x86_64-cpu` |
| `gnina` | GNINA | `linux-x86_64-cuda12.8` |
| `molecular-analysis` | MDAnalysis, ProLIF, RDKit | `linux-x86_64-cpu` |
| `biochemical-simulation` | PySB, BioNetGen, Perl | `linux-x86_64-cpu` |
| `metabolic-modeling` | COBRApy, optlang, HiGHS (default solver), GLPK | `linux-x86_64-cpu` |
| `physicell` | PhysiCell executables and a Python result reader | `linux-x86_64-cpu` |

The boundary follows what must be solved together and what must be released apart, not the number
of packages.

## Why

- **Docking is one chemistry stack.** Ringtail depends on Meeko and RDKit; Meeko writes the PDBQT
  Vina reads and turns Vina's poses back into molecules Ringtail stores. Ringtail's chemicalite pins
  librdkit 2024.09.6, so every one of them has to share that RDKit in one environment (resolved
  2026-11-03, 152 packages).
- **PDBFixer belongs to docking preparation.** Meeko's receptor templates refuse residues with
  missing or extra heavy atoms; PDBFixer repairs them. The OpenMM box is published CUDA-only, so
  putting PDBFixer there would make docking preparation require an NVIDIA GPU. The docking box carries
  the OpenMM box's exact OpenMM build (8.5.1, `py311h6619805_0`, CUDA 12.9 libraries) so both prepare
  structures with the same templates and hydrogen rules.
- **Trajectory analysis is its own consumer.** MDAnalysis and ProLIF serve OpenMM trajectories as
  much as docking; together they pull 188 packages and want a current RDKit (2026.09.1), which the
  docking environment cannot hold.
- **PySB without BioNetGen cannot generate a reaction network**, so they are one capability.
- **COBRApy, PySB and PhysiCell are unrelated and must be releasable independently**; one failing
  must not hold the others.
- **GNINA is a 2 GB CUDA executable with a GPL-2.0 licence** inherited from OpenBabel; its
  redistribution question must not touch any other box.

## What was rejected

- **One box per package.** Splitting Vina, Meeko and Ringtail would duplicate RDKit three times and
  turn one docking workflow into file hand-offs between environments that might hold different RDKit
  builds.
- **One "systems biology" box for PySB and COBRApy.** Fewer boxes, but two unrelated, independently
  versioned stacks would release together and fail together.
- **PDBFixer inside the OpenMM box.** It would reuse an environment, at the cost of a GPU requirement
  for docking and a full OpenMM re-release.
- **ProLIF inside the docking box.** Convenient for pose interaction fingerprints, but it would drag
  MDAnalysis into every docking install and force ProLIF onto the old RDKit.
