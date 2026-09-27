# Copyleft dependencies are allowed in a signed box

Taken 2026-09-11, when Boltz-2 made the project look at one for the first time.

> **Corrected the same day.** This document first said Boltz-2 brought the project its *first*
> copyleft dependency, and that every box published before it was "pure conda and entirely
> permissive". **Both are false**, and the audits in the repository say so: every published box
> carries GPL-family conda packages — between 8 and 26 of them. The first box ever published,
> MHCflurry macOS, has 8; the `native-tools` box that ships inside the app has 18, including
> `bcftools` and `bwa` under plain GPL-3.0.
>
> What was actually new is narrower and worth keeping: `frozendict` was the first copyleft
> dependency the project ever *saw*, because pixi records no licence for a PyPI package and until
> `scrollcase@1.1.0` the PyPI half of a lock could not be inventoried at all. The decision below is
> unchanged; it turns out to describe what this project has been doing all along rather than a new
> allowance. The correction matters because the old premise would tell the next reader that a GPL
> package here is unprecedented, and they would stop for an answer that already exists.

## Decision

A dependency under a copyleft licence may ship inside a signed Runtime Box, provided its licence
text travels with it and it stays a replaceable component — an unmodified package inside the box's
own packed Python environment, not code compiled into something Liatir links or ships as one binary.

The dependency that prompted it is `frozendict==2.4.7`, **LGPL-3.0-or-later**, which reaches Boltz-2
indirectly rather than by Boltz's own choice.

This is not a blanket allowance for every copyleft term. It covers a separable component: a package
inside the packed environment, or a tool the box invokes as its own process. Strong copyleft is
already here on those terms — `readline` and `ld_impl_linux-64` under GPL-3.0-only in most boxes,
`bcftools` and `bwa` in `native-tools` — and each is an unmodified upstream build that Liatir runs
or links against, never code folded into Liatir's own work. What stays unanswered is copyleft over
code Liatir would distribute *as part of itself*: GPL sources compiled into the Liatir binary, or
AGPL anywhere in a hosted path.

## Why

Refusing copyleft outright would have been the easy answer and the wrong one: it would rule out a
dependency Boltz did not choose and cannot easily drop, on a licence whole industries redistribute
without difficulty, and it would set a precedent that removes packages rather than disclosing them.
It would also have been unenforceable in practice, since a conda environment cannot be built without
`libgcc`.

The LGPL's own conditions are satisfied by what a box already does. The licence text ships — the
dependency inventory names every distribution and its licence, and the wheel's own licence files
stay inside the packed environment. The library stays replaceable: it is an ordinary Python package,
not statically linked into anything, and a user who extracts the box can substitute it.

The boundary in the decision is the part that matters. It is drawn at *how* the dependency is
carried, not at the licence name, because that is what the licence itself turns on.

## What was rejected

**Refusing all copyleft.** A clean rule with a real cost: it would have forced removing
`frozendict` from Boltz's dependency graph and re-verifying that Boltz still runs — work on someone
else's dependency tree, to avoid a term that permits exactly what we are doing.

**Deciding case by case with no rule.** The next model would have re-litigated it from scratch, and
the answer would have depended on who was asked.

## Related

- The Boltz-2 redistribution record, `runtime-boxes/legal/boltz-2.md` — the seventeen GPL-family
  distributions in that box, named, and the CC0 provenance of its molecule dictionary.
