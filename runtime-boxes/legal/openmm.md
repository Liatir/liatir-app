# OpenMM Tool Runtime

- Runtime identity: `openmm-openmm` / `molecular-simulation-openmm-8-5-1`.
- Reviewed source revision: `8.5.1+openmmforcefields-0.16.0+openff-toolkit-0.17.1+openff-sage-2.3.0+nagl-0.5.5`.
- OpenMM 8.5.1: <https://github.com/openmm/openmm/tree/8.5.1>.
- OpenMM API and Reference/CPU platform licence: MIT.
- OpenMM CUDA and OpenCL platform licence: LGPL-3.0-or-later.
- The official conda package retains `licenses/Licenses.txt`, `licenses/LGPL.txt`, and
  `licenses/GPL.txt` in every target payload.
- OpenMMForceFields 0.16.0: <https://github.com/openmm/openmmforcefields/tree/0.16.0>, MIT.
- Official OpenMMForceFields source archive:
  <https://codeload.github.com/openmm/openmmforcefields/tar.gz/refs/tags/0.16.0>.
- Source archive SHA-256: `703f1341569ec691c0af20b134bd0fc7b00b6c4049fd90ad1c1728630e7c1d99`.
- Source archive size: `33077731` bytes.
- OpenFF Toolkit 0.17.1, Interchange 0.4.11 and NAGL 0.5.5 code: MIT.
- OpenFF force-fields package 2026.01.0, containing the exact Sage `openff-2.3.0.offxml`
  force field: CC-BY-4.0.
- OpenFF NAGL models 2025.9.0 data: CC-BY-4.0.
- Exact charge model: `openff-gnn-am1bcc-1.0.0.pt`.
- Charge-model SHA-256: `7981e7f5b0b1e424c9e10a40d9e7606d96dcd3dd2b095cb4eeff6829f92238ee`.
- RDKit 2025.03.6: BSD-3-Clause.

The Linux and Windows OpenMM conda builds are unified packages that include CPU, CUDA and OpenCL
plugins. Liatir still selects the signed target backend explicitly: CPU boxes cannot silently fall
back to CUDA, and CUDA boxes cannot silently fall back to CPU. Both platforms are constrained to
CUDA 12.9 packages so dependency locks cannot drift to CUDA 13. The macOS box selects CPU only.
NAGL ligand charges use PyTorch 2.10.0 CPU on every target, including CUDA simulations; only OpenMM's
simulation platform uses the GPU. This avoids bundling an unrelated CUDA PyTorch stack.

The signed Python environment includes a Liatir startup hook that resolves OpenMM's documented
`OPENMM_PLUGIN_DIR` relative to the installed Python prefix, and retains local DLL search handles
on Windows. It imports no scientific package and uses no network. This replaces the upstream conda
build-prefix lookup without changing OpenMM itself; CPU/CUDA selection remains explicit.

The retained OpenMMForceFields source is used only for its reviewed SMIRNOFF template generator.
Project tests, documentation, force-field trees and large sample datasets are pruned. The official
`test-ala-3.pdb` and `test-aa.pdb` protein fixtures remain for scientific validation. Exact
runtime and data versions, the NAGL model hash, licence files, offline socket denial and a real
protein-plus-ligand parameterization are checked before publication. The conda dependency audit for
each target records the complete transitive licence set.

This local research runtime performs force-field minimization and standard molecular dynamics. It
does not calculate clinical efficacy, therapeutic stability, free-energy perturbation or a validated
binding affinity, and Liatir must not present its output as any of those claims.
