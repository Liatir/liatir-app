# Neural Pose Rescoring

Rescore the poses [Molecular Docking](/tools/molecular-docking) found with
[GNINA](https://github.com/gnina/gnina) 1.3.3, whose neural networks were trained
on thousands of known protein–ligand structures, and compare them with their
Vina scores. Liatir runs it entirely on your computer, on an NVIDIA graphics
card (GPU).

For every pose, GNINA gives:

- a **CNN pose score**, from 0 to 1: how likely the pose is to be close (within
  2 Å) to how the molecule really binds;
- a **CNN affinity**, a predicted binding strength in pK units, where higher
  means tighter;
- its own evaluation of the Vina score, on the same pose.

Vina often ranks a wrong pose above a correct one; the CNN pose score is a
second, independent opinion on which pose to trust.

You find it under **Tools → Molecular Docking**, and it is available as a step
in a [pipeline](/pipeline/overview), right after Molecular Docking.

## What you need

| Your computer | Can it run this tool? |
| --- | --- |
| Linux x86_64 with an NVIDIA GPU, driver 570.26 or newer, glibc 2.35 or newer (Ubuntu 22.04 or later) | Yes |
| Windows 11 with an NVIDIA GPU, through WSL2, driver 570.65 or newer | Yes |
| A computer without an NVIDIA GPU | No |
| Mac | No |

- **Graphics card.** Pascal (GeForce GTX 10 series) or newer.
- **GNINA comes from its authors.** When you install the tool from
  **Dependencies → Tool Runtimes**, Liatir downloads its package (about
  2.3 GB, NVIDIA's GPU libraries) and GNINA's own 2.1 GB program
  directly from GNINA's official release, checks that the program is exactly the
  one Liatir reviewed, and only then installs. Liatir does not redistribute
  GNINA. Together they need about 5.5 GB on disk.
- **Memory.** At least 4 GB; the GPU itself needs about 250 MB.

After installation everything works offline.

## Using it

- **Input:** the docked poses Molecular Docking wrote (SDF), and the receptor
  file they were docked into (PDBQT). Liatir checks that the poses really were
  docked into that receptor.
- **Output:** every pose with GNINA's scores added, a table with the Vina and
  GNINA scores side by side, for each ligand the pose Vina ranks first and the
  one GNINA ranks first, and a plot of both scores.

GNINA scores each pose where it lies: it does not move it.

## How it was checked

Before publication, the exact package was tested on a GeForce RTX 4060 Ti with
GNINA's own release program:

- GNINA's own official tests pass.
- Its results on the GPU and on the processor agree within 0.0015, GNINA's own
  tolerance.
- On imatinib redocked into the Abl kinase (PDB entry 1IEP), the pose GNINA
  ranks first is 0.90 Å from the crystal structure; the usual
  criterion is 2 Å.
- In a screen of six molecules, GNINA placed every pose close to the crystal
  structure above every wrong one; Vina had ranked two poses 12 Å away above a
  correct one.
- Its Vina evaluation of Vina's best pose matches Vina's own score
  (−13.22 kcal/mol).

The same package then ran inside the real Liatir app, from installation —
including GNINA's download — to results and removal, on Linux and on Windows
through WSL2.

## What the results mean

GNINA's CNN pose score estimates how likely a pose is to lie within 2 Å of the
true binding mode, and its CNN affinity is a predicted binding affinity in pK
units; both are predictions of neural networks trained on known complexes, not
measurements, and a rescored pose is still a hypothesis to test. Liatir shows
this notice with every result.

## Licences and official source

- [GNINA 1.3.3](https://github.com/gnina/gnina/releases/tag/v1.3.3): dual
  licensed under GPL and Apache; the released program is GPL-2.0 because it
  includes OpenBabel. It is downloaded from GNINA's own release, not from
  Liatir.
- The package includes NVIDIA's CUDA libraries and cuDNN under NVIDIA's own
  licences. Your NVIDIA driver is not part of it.
