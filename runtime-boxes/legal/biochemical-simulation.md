# Biochemical Simulation Tool Runtime

- Runtime identity: `pysb-biochemical-simulation` / `biochemical-simulation-pysb-1-17-0`.
- Reviewed source revision: `pysb-1.17.0+bionetgen-2.9.3`.
- PySB 1.17.0: <https://github.com/pysb/pysb/tree/v1.17.0>, BSD-2-Clause, the unmodified wheel from PyPI
  (SHA-256 `8e2b8d23d44443686a88056afe126b308a6fa9b635e44169e7ea16e07984a55f`); declared in
  `runtime-boxes/legal/audits/biochemical-simulation-linux-x86_64-cpu-pypi-declaration.json`.
- BioNetGen 2.9.3: <https://github.com/RuleWorld/bionetgen/releases/tag/BioNetGen-2.9.3>, MIT, the official
  Linux release archive `BioNetGen-2.9.3-linux.tar.gz` (2,221,958 bytes, SHA-256
  `b85743d422aa3fd112aceb3725dd1b1f2ff1ad829d20d71682680426582bcb5d`), unpacked under `bionetgen-release/BioNetGen-2.9.3/`
  with its `LICENSE` and `CREDITS.txt`. Its `run_network` executable has SUNDIALS CVODE 2.6.0 (BSD-3-Clause) and
  muParser (MIT) compiled in, declared in
  `runtime-boxes/legal/audits/biochemical-simulation-linux-x86_64-cpu-bundled-declaration.json`.
- Perl 5.44 from conda-forge, under the Artistic License or the GPL (the licensee's choice), runs
  BioNetGen's `BNG2.pl`.

The conda packages ship unmodified with their licence files, on the basis recorded in
[Copyleft dependencies in signed boxes](../../.context/decisions/copyleft-dependencies-in-signed-boxes.md);
the complete transitive inventory is `runtime-boxes/legal/audits/biochemical-simulation-linux-x86_64-cpu.json`.

Pruned from the payload: `venv/lib/python3.1` (conda's link to `python3.11`, which the build would
otherwise copy in full); BioNetGen's `bin/NFsim`, the network-free simulator, which no Liatir tool runs;
and the 167 macOS resource-fork files (`._*`) the upstream archive carries.

BioNetGen's Linux executables need glibc 2.34 or newer (Ubuntu 22.04 or newer).

## Reference data

The self-test and validator use the models that ship inside PySB (`pysb.examples`) and BioNetGen
(`bionetgen-release/BioNetGen-2.9.3/Models2`), and the reference solution of the Robertson problem published in the Test Set for
IVP Solvers (Mazzia and Magherini, University of Bari), quoted in the validator as numbers.

## Scientific limits

A simulation describes the model's reactions, rate laws and parameters, not the cell they stand for.
Deterministic results assume well-mixed, large populations; stochastic results are samples whose
statistics depend on the number of runs.
