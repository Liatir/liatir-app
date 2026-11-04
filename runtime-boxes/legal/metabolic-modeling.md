# Metabolic Modeling Tool Runtime

- Runtime identity: `cobrapy-metabolic-modeling` / `metabolic-modeling-cobrapy-0-32-1`.
- Reviewed source revision: `cobrapy-0.32.1+optlang-1.9.1+highs-1.15.1+osqp-1.1.3+glpk-5.0`.
- COBRApy 0.32.1: <https://github.com/opencobra/cobrapy/tree/0.32.1>, offered under LGPL-2.0-or-later
  or GPL-2.0-or-later; Liatir distributes it under LGPL-2.0-or-later.
- optlang 1.9.1: <https://github.com/opencobra/optlang/tree/1.9.1>, Apache-2.0.
- HiGHS 1.15.1 (`highspy`): <https://github.com/ERGO-Code/HiGHS>, MIT. The default solver.
- OSQP 1.1.3: <https://github.com/osqp/osqp-python>, Apache-2.0. optlang's hybrid interface, which is
  how COBRApy reaches HiGHS, requires it; it solves the quadratic problems no Liatir tool offers yet.
- GLPK 5.0 and swiglpk 5.0.13: GPL-3.0-or-later and GPL-3.0-only. COBRApy and optlang depend on them;
  Liatir uses GLPK only as the independent cross-check of HiGHS.
- libSBML 5.21.2 (`python-libsbml`): LGPL-2.1-only. It reads and writes SBML models.
- optlang's symbolic layer brings SymPy's arbitrary-precision arithmetic: GMP (GPL-2.0-or-later OR
  LGPL-3.0-or-later), MPFR (LGPL-3.0-only), MPC, FLINT and gmpy2 (LGPL-3.0-or-later).

Every component is the unmodified conda-forge package, an ordinary replaceable Python package or
shared library inside the box's own environment, shipped with its licence files. COBRApy, libSBML,
GLPK, swiglpk and the arithmetic libraries ship on the basis recorded in
[Copyleft dependencies in signed boxes](../../.context/decisions/copyleft-dependencies-in-signed-boxes.md),
as do the GPL-family conda dependencies — the GCC runtime libraries under the GCC runtime library
exception, `readline`, `ld_impl_linux-64` and the LGPL libraries. The complete transitive inventory
with declared licences is `runtime-boxes/legal/audits/metabolic-modeling-linux-x86_64-cpu.json`.

The packed conda prefix ships whole. The scroll prunes one path, `venv/lib/python3.1`: conda's Python
declares it as a link to `python3.11`, and the build would otherwise ship a full second copy of the
Python library.

COBRApy can download models from BiGG and BioModels through `httpx`. Liatir never calls that path:
the runner denies network sockets before importing COBRApy and reads only model files the user
selects.

## Reference data

The scientific self-test and validator use only the models that ship inside COBRApy 0.32.1:
`cobra/data/textbook.xml.gz` (the E. coli core metabolism model of Orth, Fleming and Palsson,
EcoSal Plus 2010), `iJO1366.xml.gz` (Orth et al., Mol. Syst. Biol. 2011) and `salmonella.xml.gz`, under
COBRApy's licence. The validator also compares flux variability against the table COBRApy's own test
suite pins for the textbook model, `tests/data/textbook_fva.json` at tag 0.32.1 (SHA-256
`cbf1767dda4f87bfdc1817d47a2b1ee34d8a6dcaa74897267e14b318c6e3c385`), kept in the repository as
`runtime-boxes/fixtures/metabolic/cobrapy-0.32.1-textbook-fva.json`; it is not part of the box.

## Scientific limits

Flux balance analysis predicts steady-state fluxes that optimize a chosen objective under the
model's stoichiometry and bounds. A predicted growth rate or flux is a property of the model and its
assumptions, not a measurement; an essential gene in the model is a hypothesis about the organism.
