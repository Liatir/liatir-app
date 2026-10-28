# Molecular Relaxation and Molecular Dynamics

Two tools that simulate how the atoms of a molecule move, using
[OpenMM](https://openmm.org) 8.5.1, an open-source physics engine. Liatir runs
them entirely on your computer, on an NVIDIA graphics card (GPU).

- **Molecular Relaxation** gently moves the atoms of a structure until strain and
  clashes are gone and its energy is as low as it can get nearby (an energy
  minimization). Use it to clean up a structure you downloaded or predicted
  before you look at it or simulate it.
- **Molecular Dynamics** simulates how the atoms move over time at a temperature
  you choose, and gives you a trajectory you can play back, plus the energy and
  temperature at every saved moment.

You find both under **Tools → Molecular Simulation**, and both are available as
steps in a [pipeline](/pipeline/overview).

## What you need

OpenMM is a **Tool Runtime**: a scientific program that Liatir installs once,
on request, and keeps separate from everything else. It is not an AI Model — it
calculates physics and learns nothing from data — so you install it from
**Dependencies → Tool Runtimes**, not from the AI Models page.

| Your computer | Can it run these tools? |
| --- | --- |
| Linux x86_64 with an NVIDIA GPU, driver 575.51.03 or newer | Yes |
| Windows 11 with an NVIDIA GPU, through WSL2, driver 576.02 or newer | Yes |
| Windows or Linux without an NVIDIA GPU | Not yet |
| Mac | No |

- **Why a recent driver.** OpenMM prepares its GPU code when it starts and asks
  the NVIDIA driver to finish it. This version of OpenMM needs a driver that
  supports CUDA 12.9; an older one would install fine and then fail on every
  run. Liatir checks your driver before downloading anything and tells you if
  it needs updating.
- **On Windows**, OpenMM runs inside WSL2, as the
  [native tools](/tools/overview#windows-and-wsl2) do, and your graphics card
  must be visible inside WSL2. If Liatir says it is not, run `wsl --update` and
  restart WSL2.
- **Memory and disk.** At least 8 GB of memory. The download is about 1.3 GB
  and needs about 3.7 GB once installed. The GPU itself needs very little memory
  for these tools: under 200 MB in every case below.

After installation everything works offline. The simulation never connects to
the network.

## Molecular Relaxation

- **Input:** a structure as PDB or mmCIF. Optionally one small molecule
  (ligand) as an SDF file, if that molecule is already part of the structure.
- **Options:** add missing hydrogens at a chosen pH, surround the molecule with
  water (TIP3P-FB) and salt, the maximum number of steps and the stopping
  tolerance, and a seed so the run can be repeated.
- **Output:** the relaxed structure as mmCIF, which opens in the
  [3D Structure Viewer](/visualization/structure-viewer), the energy before and
  after, and the full record of what was run.

## Molecular Dynamics

- **Input:** the same structures as above, or a checkpoint from an earlier run
  to continue it.
- **Options:** a 10 ps check, a 100 ps run or a custom length; the temperature;
  the pressure, only when the system is in water; how often to save a frame;
  and a seed.
- **Output:** the trajectory (DCD) with its topology, the final structure, a
  table and plots of energy and temperature over time, and a checkpoint that
  lets you continue the simulation later.

## Force fields and chemistry

Proteins use Amber19, water uses TIP3P-FB, and small molecules use OpenFF Sage
2.3.0 with charges from the NAGL AM1-BCC model. Some chemistry is outside these
force fields, for example membrane lipids. When a structure contains a residue
they cannot describe, Liatir refuses the run and names that residue rather than
guessing or silently dropping it. If it is a small molecule, supplying its SDF
usually solves it.

## How it was checked

Before publication, the exact package you download was tested on a GeForce RTX
4060 Ti with 8 GB of memory:

- The energy it calculates matches OpenMM's own reference implementation within
  0.0002 kJ/mol, on identical coordinates.
- Dihydrofolate reductase (DHFR), the standard benchmark protein with 2,489
  atoms, relaxed in about 4 seconds; with the approved drug ruxolitinib bound
  to it, in about 10 seconds.
- DHFR in water and salt, 29,419 atoms — the realistic shape of a simulation —
  relaxed in about 13 seconds, and 10 ps of dynamics took about 15 seconds. The
  temperature settled at the 300 K requested: 301.8 K on average once the system
  had equilibrated.
- A changed or corrupted checkpoint, a missing ligand and a residue the force
  fields cannot describe were all refused.

The same package then ran inside the real Liatir app, from installation to
results and removal, on Linux and on Windows through WSL2.

Larger systems than those measured are allowed: Liatir tells you the run goes
beyond what was measured and asks you to confirm before it starts.

## What the results mean

OpenMM simulates atomic motion with a force field. It does not prove binding
affinity, molecular stability, clinical benefit, or therapeutic efficacy.
Liatir shows this notice with every result. Runs of 10 to 100 ps are short:
they are useful to check and relax a structure, while studying how a protein
actually behaves usually takes nanoseconds or more, and the result always
depends on the starting structure you provide.

## Licences and official source

- [OpenMM 8.5.1](https://github.com/openmm/openmm/tree/8.5.1): MIT for the core,
  LGPL-3.0-or-later for its GPU platform.
- [OpenMMForceFields 0.16.0](https://github.com/openmm/openmmforcefields/tree/0.16.0)
  and the OpenFF Toolkit: MIT. OpenFF force fields and the NAGL charge model:
  CC-BY-4.0.
- The package includes NVIDIA's CUDA runtime compiler and FFT library under
  NVIDIA's own licence. Your NVIDIA driver is not part of it.
- [OpenMM documentation](https://docs.openmm.org/8.5.0/)
