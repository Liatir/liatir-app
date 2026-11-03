# Molecular Analysis Tool Runtime

- Runtime identity: `mdanalysis-molecular-analysis` / `molecular-analysis-mdanalysis-2-11-0`.
- Reviewed source revision: `mdanalysis-2.11.0+prolif-2.2.3+rdkit-2026.09.1`.
- MDAnalysis 2.11.0: <https://github.com/MDAnalysis/mdanalysis/tree/package-2.11.0>. The library is
  packaged under LGPL-3.0-or-later; contributions are LGPL-2.1-or-later.
- ProLIF 2.2.3: <https://github.com/chemosim-lab/ProLIF/tree/v2.2.3>, Apache-2.0.
- RDKit 2026.09.1: BSD-3-Clause.

Every component is the unmodified conda-forge package, an ordinary replaceable Python package inside
the box's own environment, shipped with its licence files. MDAnalysis and its own dependencies
GridDataFormats (LGPL-3.0-or-later) and pyedr (LGPL-2.1-or-later) ship on the basis recorded in
[Copyleft dependencies in signed boxes](../../.context/decisions/copyleft-dependencies-in-signed-boxes.md),
as do the GPL-family conda dependencies — the GCC runtime libraries under the GCC runtime library
exception, `readline`, `ld_impl_linux-64` and the LGPL libraries. Four packages carry licences with no
SPDX identifier, each permitting redistribution of unmodified copies with their notices: Biopython
(the Biopython License Agreement), Qhull, the Ubuntu Font Licence of `font-ttf-ubuntu`, and `tzdata`
(public domain). The complete transitive inventory with declared licences is
`runtime-boxes/legal/audits/molecular-analysis-linux-x86_64-cpu.json`.

The packed conda prefix ships whole. The scroll prunes one path, `venv/lib/python3.1`: conda's Python
declares it as a link to `python3.11`, and the build would otherwise ship a full second copy of the
Python library.

## Reference data

The scientific self-test and validator use only data that ships inside ProLIF 2.2.3 under its
Apache-2.0 licence: `prolif/data/top.pdb` and `traj.xtc`, a protein–ligand molecular dynamics
trajectory, and the small molecules ProLIF's own test suite uses to define each interaction type with
its negative controls (for example `donor.mol2`, `acceptor.mol2` and `acceptor_false.mol2`).

## Scientific limits

Trajectory measures (RMSD, RMSF, distances, contacts) describe the simulation that produced the
trajectory, under its force field and sampling; they are not experimental observations. Interaction
fingerprints apply geometric rules to coordinates: a detected interaction is a geometric criterion
met in a frame or pose, not a measured binding contribution.
