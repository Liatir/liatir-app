# Molecular Docking Tool Runtime

- Runtime identity: `autodock-vina-molecular-docking` / `molecular-docking-vina-1-2-7`.
- Reviewed source revision:
  `vina-1.2.7+meeko-0.8.0+ringtail-2.3.1+pdbfixer-1.12+openmm-8.5.1+rdkit-2024.09.6`.
- AutoDock Vina 1.2.7, official Python bindings: <https://github.com/ccsb-scripps/AutoDock-Vina/tree/v1.2.7>,
  Apache-2.0.
- Meeko 0.8.0: <https://github.com/forlilab/Meeko/tree/v0.8.0>, LGPL-2.1-only.
- Ringtail 2.3.1: <https://github.com/forlilab/Ringtail/tree/v2.3.1>, LGPL-2.1-only.
- chemicalite 2024.05.1 (Ringtail's SQLite chemistry extension): BSD-3-Clause.
- PDBFixer 1.12: <https://github.com/openmm/pdbfixer/tree/v1.12>, MIT.
- OpenMM 8.5.1, the same conda build as the OpenMM Tool Runtime (`py311h6619805_0`): API and
  Reference/CPU platforms MIT; CUDA and OpenCL platform plugins LGPL-3.0-or-later. The official conda
  package retains `licenses/Licenses.txt`, `licenses/LGPL.txt` and `licenses/GPL.txt`.
- RDKit 2024.09.6: BSD-3-Clause. Gemmi 0.7.5: MPL-2.0. ProDy 2.6.1: MIT.

Every component is the unmodified conda-forge package, an ordinary replaceable Python package
inside the box's own environment. Meeko and Ringtail are LGPL-2.1-only and ship with their licence
files on the basis recorded in
[Copyleft dependencies in signed boxes](../../.context/decisions/copyleft-dependencies-in-signed-boxes.md).
The GPL-family conda dependencies — the GCC runtime libraries under the GCC runtime library
exception, `readline`, `ld_impl_linux-64` and the LGPL libraries — ship on the same basis. The
complete transitive inventory with declared licences is
`runtime-boxes/legal/audits/molecular-docking-linux-x86_64-cpu.json`.

OpenMM is present only as PDBFixer's library: it reads structures, holds residue templates, adds
hydrogens and minimizes repaired atoms, always on its CPU platform, which the runner names explicitly.
The OpenMM conda build is unified, so the box also carries, unmodified, OpenMM's CUDA, OpenCL and HIP
platform plugins (LGPL-3.0-or-later) and three packages under the NVIDIA CUDA Toolkit End User License
Agreement — `cuda-nvrtc` 12.9.86, `libcufft` 11.4.1.4 and the `cuda-version` 12.9 constraint — the same
packages and versions the published OpenMM, scGPT, Geneformer and Boltz-2 boxes already distribute.
The packed conda prefix ships whole. The OpenMM Tool Runtime's startup hook is reused unchanged to
resolve `OPENMM_PLUGIN_DIR` inside the relocated environment.

The scroll prunes one path, `venv/lib/python3.1`: conda's Python declares it as a link to
`python3.11`, and the build would otherwise ship a full second copy of the Python library.

## Reference fixtures

The official AutoDock Vina basic-docking example is carried for scientific validation, fetched from
the v1.2.7 commit `8eb40404f4f45608acb3b01427587ac049f27c1f` with pinned SHA-256 and distributed
under the repository's Apache-2.0 licence: `1iep_receptorH.pdb` and `1iep_ligand.sdf` (the c-Abl
kinase domain and imatinib from PDB entry 1IEP, prepared by the Vina authors) and the official
solution files `1iep_ligand.pdbqt`, `1iep_receptor.pdbqt`, `1iep_receptor.box.txt` and
`1iep_ligand_vina_out.pdbqt`. PDB entry data is CC0.

## Scientific limits

Vina scores are empirical scoring-function values in kcal/mol used to rank poses. They are not
measured binding affinities, free energies or evidence of biological activity, and Liatir must not
present them as such. A docked pose is a hypothesis, not a parameterized molecular system.
