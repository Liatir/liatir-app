# Receptor Preparation, Molecular Docking and Docked Complex

Three tools that predict how a small molecule (a ligand) could sit inside a
protein, using [AutoDock Vina](https://vina.scripps.edu) 1.2.7, a widely used
open-source docking program. Liatir runs them entirely on your computer.

- **Receptor Preparation** turns a protein structure into the file Vina docks
  into: it repairs missing atoms, adds hydrogens at the pH you choose, and tells
  you every change it made.
- **Molecular Docking** places one ligand, or a whole library of them, into the
  binding site you choose and ranks the poses it finds by Vina score.
- **Docked Complex** takes one docked pose together with its protein, as the
  starting structure for a [molecular simulation](/tools/molecular-simulation).

You find them under **Tools → Molecular Docking**, and all three are available
as steps in a [pipeline](/pipeline/overview).

## What you need

These tools run on a **Tool Runtime**: a scientific program that Liatir installs
once, on request, and keeps separate from everything else. Install it from
**Dependencies → Tool Runtimes**.

| Your computer | Can it run these tools? |
| --- | --- |
| Linux x86_64 | Yes |
| Windows 11, through WSL2 | Yes |
| Mac | No |

- **No graphics card is needed.** Docking runs on the processor.
- **Memory and disk.** At least 4 GB of memory. The download is about
  592 MB and needs about 1.5 GB
  once installed.
- **On Windows**, the tools run inside WSL2, as the
  [native tools](/tools/overview#windows-and-wsl2) do.

After installation everything works offline.

## Receptor Preparation

- **Input:** a protein structure as PDB or mmCIF.
- **Options:** which chains to keep, whether to remove crystallographic waters,
  which other residues to remove (for example a ligand already in the
  structure), whether to repair missing atoms or model short missing loops, and
  the pH at which hydrogens are added.
- **Output:** the prepared receptor as PDB, which opens in the
  [3D Structure Viewer](/visualization/structure-viewer), the receptor file
  Vina docks into (PDBQT), and a report of every change.

Every residue is re-protonated at the pH you choose, replacing any hydrogens the
file already had. Nothing is removed unless you asked for it. A residue Liatir
cannot describe is refused by name instead of being dropped.

## Molecular Docking

- **Input:** the receptor file from Receptor Preparation, and one or more
  ligands as an SDF file with 3D coordinates.
- **Binding site:** either a box you place by its centre and size, in ångström,
  or a box drawn around a reference ligand you supply.
- **Options:** the scoring function (Vina or Vinardo), how hard to search
  (exhaustiveness), how many poses to keep per ligand, a seed so the run can be
  repeated, and how many processor threads to use.
- **Output:** every pose as SDF, a table of scores, the receptor with the best
  pose, and a screening database you can extend with later runs on the same
  site. Molecules Vina cannot dock — a flat 2D drawing, a salt with separate
  pieces, an element Vina does not know — are listed with the reason.

## Docked Complex

Choose a ligand and one of its poses. Liatir writes the protein with that pose
as one PDB file, ready for Molecular Relaxation or Molecular Dynamics, and the
ligand on its own as SDF. It checks that the pose really was docked into that
protein.

## How it was checked

Before publication, the exact package you download was tested on AutoDock Vina's
own official example: imatinib, a leukaemia drug, bound to the Abl kinase
(PDB entry 1IEP).

- Redocked into its protein, imatinib's best pose lies 0.37 Å from where
  it sits in the crystal structure. The usual criterion for a successful
  redocking is 2 Å. Its score, −13.22 kcal/mol, matches the official
  tutorial's −13.23.
- The same holds when the protein is prepared here from the raw PDB entry.
- The ligand file Liatir prepares is identical, atom type by atom type, to the
  official one.
- The same seed gives identical poses, with 1 thread or with 6.
- In a screen of nine molecules, six docked and three were refused, each with
  its reason.

The same package then ran inside the real Liatir app, from installation to
results and removal, on Linux and on Windows through WSL2. A pose taken through
Docked Complex into a 100 ps simulation in water kept imatinib's key hydrogen
bond to the protein in every frame.

## What the results mean

Vina scores are empirical scoring-function values in kcal/mol used to rank
poses. They are not measured binding affinities, free energies or evidence of
biological activity, and a docked pose is a hypothesis to test, not a result.
Liatir shows this notice with every result.

## Licences and official source

- [AutoDock Vina 1.2.7](https://github.com/ccsb-scripps/AutoDock-Vina): Apache-2.0.
- [Meeko 0.8.0](https://github.com/forlilab/Meeko) and
  [Ringtail 2.3.1](https://github.com/forlilab/Ringtail): LGPL-2.1.
- [PDBFixer 1.12](https://github.com/openmm/pdbfixer) and the OpenMM library it
  uses: MIT, with LGPL-3.0-or-later for OpenMM's GPU platforms.
- [RDKit](https://www.rdkit.org): BSD-3-Clause.
