# Trajectory Analysis and Interaction Fingerprint

Two tools that measure what happens in a molecular simulation or a docking run,
using [MDAnalysis](https://www.mdanalysis.org) 2.11 and
[ProLIF](https://prolif.readthedocs.io) 2.2.3. Liatir runs them entirely on your
computer.

- **Trajectory Analysis** measures how a protein and its ligand move during a
  simulation: how far they drift from their starting shape (RMSD), how much
  each residue fluctuates (RMSF), and the distance between any two groups of
  atoms you name.
- **Interaction Fingerprint** lists the contacts between a ligand and its
  protein — hydrogen bonds, hydrophobic contacts, π-stacking and more — frame by
  frame in a simulation, or pose by pose after docking.

You find them under **Tools → Molecular Simulation**, and both are available as
steps in a [pipeline](/pipeline/overview), for example right after
[Molecular Dynamics](/tools/molecular-simulation) or
[Molecular Docking](/tools/molecular-docking).

## What you need

These tools run on a **Tool Runtime** that Liatir installs once, on request,
from **Dependencies → Tool Runtimes**.

| Your computer | Can it run these tools? |
| --- | --- |
| Linux x86_64 | Yes |
| Windows 11, through WSL2 | Yes |
| Mac | No |

- **No graphics card is needed.** The analysis runs on the processor.
- **Memory and disk.** At least 4 GB of memory. The download is about
  317 MB and needs about 945 MB
  once installed.

After installation everything works offline, and the tools never change the
files you give them.

## Trajectory Analysis

- **Input:** a topology (PDB) and its trajectory (DCD or XTC), such as the ones
  Molecular Dynamics writes, and optionally the simulation's state record, so
  frame times are checked against it.
- **Options:** which atoms are the ligand, what to superpose on before measuring,
  whether to compute per-residue fluctuation, a named distance between two atom
  selections, and which frames to read.
- **Output:** tables of RMSD, RMSF and distances over time, with plots.

## Interaction Fingerprint

- **Input:** either a simulation (topology, trajectory and the ligand's atoms,
  optionally the ligand as an SDF file so its chemistry is exact), or docked
  poses (the receptor with its hydrogens, and the poses as SDF).
- **Options:** which kinds of interaction to look for, and which frames to read.
- **Output:** every interaction found, how often each one occurs, and the full
  fingerprint table, one row per frame or pose.

## How it was checked

Before publication, the exact package you download was tested:

- RMSD, RMSF and distances agree with an independent calculation to within
  0.00005 Å.
- All 61 of ProLIF's own official interaction tests pass.
- On ProLIF's own example trajectory and docked poses, the tool finds exactly
  what ProLIF finds when run directly.
- A real 100 ps simulation of imatinib in its protein, in water — 61,538 atoms —
  was analysed in seconds, and the key hydrogen bond held in every frame.
- The same request twice gives identical tables.

The same package then ran inside the real Liatir app, from installation to
results and removal, on Linux and on Windows through WSL2.

## What the results mean

Trajectory measures describe the simulation that produced the trajectory, under
its force field and sampling; they are not experimental observations. A detected
interaction is a geometric criterion met in a frame or pose, not a measured
binding contribution. Liatir shows this notice with every result.

## Licences and official source

- [MDAnalysis 2.11.0](https://github.com/MDAnalysis/mdanalysis): LGPL-3.0-or-later.
- [ProLIF 2.2.3](https://github.com/chemosim-lab/ProLIF): Apache-2.0.
- [RDKit](https://www.rdkit.org): BSD-3-Clause.
