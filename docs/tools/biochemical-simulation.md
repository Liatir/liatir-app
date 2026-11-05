# Biochemical Simulation

Simulate how the amounts of molecules in a network of chemical reactions change
over time, using [PySB](https://pysb.org) 1.17.0 and
[BioNetGen](https://bionetgen.org) 2.9.3. Liatir runs it entirely on your
computer.

Models are written as *rules* — "A binds B", "the bound form is
phosphorylated" — from which BioNetGen works out every species and reaction.
The simulation can be:

- **deterministic**: smooth curves for large numbers of molecules (ordinary
  differential equations);
- **stochastic**: individual random runs for small numbers of molecules, where
  chance matters (the Gillespie method), repeated as many times as you ask.

You find it under **Tools → Systems Biology**, and it is available as a step in
a [pipeline](/pipeline/overview).

## What you need

Biochemical Simulation runs on a **Tool Runtime** that Liatir installs once, on
request, from **Dependencies → Tool Runtimes**.

| Your computer | Can it run this tool? |
| --- | --- |
| Linux x86_64 with glibc 2.34 or newer (Ubuntu 22.04 or later) | Yes |
| Windows 11, through WSL2 | Yes |
| Mac | No |

- **No graphics card is needed.**
- **Memory and disk.** At least 4 GB of memory. The download is about
  137 MB and needs about
  411 MB once installed.

After installation everything works offline.

## Using it

- **Input:** one of PySB's reviewed example models, or your own model as a
  BNGL file. Instructions a BNGL file contains (its *actions*) are read and
  listed, never run: Liatir decides what is simulated.
- **Options:** deterministic or stochastic; the end time and how many points to
  report, evenly or logarithmically spaced; the solver's tolerances; for
  stochastic runs, how many runs and the seed of the first; and changes to any
  parameter.
- **Output:** every observable over time as a table and plot, every stochastic
  run, and the reaction network BioNetGen generated.

Some rule sets never stop generating new species, for example a polymer that
can always grow by one more unit. Liatir stops network generation at 4 GB of
memory or 5 minutes of computing and tells you why, instead of running for
hours.

## How it was checked

Before publication, the exact package you download was tested against reference
solutions:

- Robertson's chemical reaction problem, a standard hard test for solvers,
  matches its published reference solution to nine significant digits.
- A model with an exact mathematical solution matches it within 0.0000001.
- 1,000 stochastic runs of a model whose outcome is known reach the expected
  mean and variance of 10 within their statistical bounds (mean 9.85, variance
  9.95), and the same seeds repeat exactly.
- BioNetGen's own EGFR signalling model (356 species, 3,749 reactions) matches
  BioNetGen's own solver within 0.00000003.

The same package then ran inside the real Liatir app, from installation to
results and removal, on Linux and on Windows through WSL2.

## What the results mean

A simulation describes the model's reactions, rate laws and parameters, not the
cell they stand for. Deterministic results assume well-mixed, large
populations; stochastic results are samples whose statistics depend on the
number of runs. Liatir shows this notice with every result.

## Licences and official source

- [PySB 1.17.0](https://github.com/pysb/pysb): BSD-2-Clause.
- [BioNetGen 2.9.3](https://github.com/RuleWorld/bionetgen): MIT; its programs
  include SUNDIALS (BSD-3-Clause).
- Perl: Artistic License or GPL.
