# Copyleft dependencies are allowed in a signed box

Taken 2026-09-11, when Boltz-2 brought the project its first one.

## Decision

A dependency under a copyleft licence may ship inside a signed Runtime Box, provided its licence
text travels with it and it stays a replaceable component — an unmodified package inside the box's
own packed Python environment, not code compiled into something Liatir links or ships as one binary.

The first such dependency is `frozendict==2.4.7`, **LGPL-3.0-or-later**, which reaches Boltz-2
indirectly rather than by Boltz's own choice.

This is not a blanket allowance for every copyleft term. It covers weak copyleft on a separable
library, which is what LGPL is for. A strong-copyleft licence over code Liatir would have to
distribute as part of its own work — GPL in a linked binary, AGPL anywhere in a hosted path — is a
different question and has not been answered here.

## Why

Every box published before today was pure conda and entirely permissive, so the question had never
come up. Refusing copyleft outright would have been the easy answer and the wrong one: it would rule
out a dependency Boltz did not choose and cannot easily drop, on a licence whole industries
redistribute without difficulty, and it would set a precedent that removes packages rather than
disclosing them.

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

- [Boltz-2 redistribution record](../../runtime-boxes/legal/boltz-2.md) — where the LGPL dependency
  and the still-open `mols.tar` provenance question are recorded.
