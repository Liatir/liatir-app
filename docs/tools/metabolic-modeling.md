# Metabolic Modeling

Predict how fast an organism can grow, how it routes its metabolism, and which
of its genes it cannot do without, from a genome-scale metabolic model, using
[COBRApy](https://opencobra.github.io/cobrapy/) 0.32.1. Liatir runs it entirely
on your computer.

You find it under **Tools → Systems Biology**, and it is available as a step in
a [pipeline](/pipeline/overview).

## What you need

Metabolic Modeling runs on a **Tool Runtime** that Liatir installs once, on
request, from **Dependencies → Tool Runtimes**.

| Your computer | Can it run this tool? |
| --- | --- |
| Linux x86_64 | Yes |
| Windows 11, through WSL2 | Yes |
| Mac | No |

- **No graphics card is needed.**
- **Memory and disk.** At least 4 GB of memory. The download is about
  209 MB and needs about 607 MB
  once installed.

After installation everything works offline. Liatir never downloads models: you
choose the model file.

## Using it

- **Input:** a metabolic model as SBML (`.xml`, also gzipped) or COBRA JSON,
  for example one from [BiGG Models](http://bigg.ucsd.edu).
- **Analyses:**
  - **Flux balance analysis (FBA)** finds the fluxes that maximise (or
    minimise) one reaction, usually growth. Optionally the solution with the
    least total flux among the optimal ones (pFBA).
  - **Flux variability analysis (FVA)** gives the range each reaction can take
    while keeping the objective near its optimum.
  - **Single gene or reaction deletions** remove each gene or reaction in turn
    and report which ones the model cannot grow without.
- **Options:** the reaction to optimise, bound changes (for example a different
  sugar or no oxygen), genes to knock out first, and a confirmation of every
  result by a second, independent solver.
- **Output:** tables of fluxes, flux ranges and deletion results, with the
  objective value.

The default solver is HiGHS; GLPK is the independent second opinion.

## How it was checked

Before publication, the exact package you download was tested on the models and
reference results COBRApy itself ships:

- E. coli core grows at 0.8739 per hour, the value COBRApy documents
  (0.8739), within 0.000000001.
- Flux variability for all 95 reactions matches COBRApy's own reference table.
- Single gene deletions find COBRApy's 7 essential genes; single reaction
  deletions find its 18 essential reactions.
- On the full E. coli model iJO1366 — 2,583 reactions and 1,367 genes — the two
  solvers agree.
- Models that cannot grow, unknown reactions or genes, impossible bounds and
  malformed files are refused with a clear reason.

The same package then ran inside the real Liatir app, from installation to
results and removal, on Linux and on Windows through WSL2.

## What the results mean

Flux balance analysis predicts steady-state fluxes that optimize the chosen
objective under the model's stoichiometry and bounds. A predicted growth rate or
flux is a property of the model and its assumptions, not a measurement; an
essential gene in the model is a hypothesis about the organism. Liatir shows
this notice with every result.

## Licences and official source

- [COBRApy 0.32.1](https://github.com/opencobra/cobrapy): LGPL-2.0-or-later or
  GPL-2.0-or-later; Liatir uses it under the LGPL.
- [optlang 1.9.1](https://github.com/opencobra/optlang): Apache-2.0.
- [HiGHS 1.15.1](https://highs.dev): MIT.
- [GLPK 5.0](https://www.gnu.org/software/glpk/) and swiglpk: GPL-3.0.
