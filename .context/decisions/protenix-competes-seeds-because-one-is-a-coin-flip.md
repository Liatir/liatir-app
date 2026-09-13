# Protenix draws several seeds and returns the best-ranked, because one seed is a coin flip

Taken 2026-09-13, from measurements made on this machine's GPU against the experimental ubiquitin
structure (PDB 1UBQ at 1.8 A), using the signed `protenix-base-v1-0-0` box and the shipped product
runner. Every number below was measured, not estimated.

## Decision

A Protenix prediction **draws five independent seeds** — the caller's seed and the four consecutive
values after it — and returns the structure Protenix itself ranks highest across all of them.
Upstream's own **`deterministic` mode is switched on**, so a given input and seed always produce the
same structure. Confidence leaves the box as a **fraction on 0 to 1**, and a prediction that scores
below **0.85** carries an explicit warning that the fold may be wrong.

## What the measurements showed

**One seed is close to a coin flip.** Eleven seeds, single-seed runs, product settings otherwise:

| Outcome | Seeds | pLDDT | Backbone RMSD |
| --- | --- | ---: | ---: |
| Found the fold | 2, 11, 17, 23, 101 | 0.93 | 1.77 – 2.20 A |
| Missed the fold | 1, 3, 7, 42, 64, 128 | 0.68 – 0.71 | 12.5 – 13.3 A |

**Five seeds fix it.** Each of these runs starts from a seed that failed on its own:

| Starting seed | Seed returned | Alone | With five seeds |
| ---: | ---: | ---: | ---: |
| 1 | 2 | 13.32 A | **1.83 A** |
| 3 | 6 | 13.00 A | **1.89 A** |
| 7 | 11 | 12.95 A | **1.77 A** |
| 64 | 65 | 12.87 A | **1.90 A** |

**The ranking score picks the right one.** Across every measured run the score separates the two
outcomes with no overlap at all: 0.1838 – 0.1840 when the fold is right, 0.1242 – 0.1347 when it is
wrong. pLDDT separates them equally cleanly, which is why 0.85 is a usable warning threshold — it
sits in an empty band between the two populations rather than inside either.

**Samples are nearly free; seeds are what cost.** Five seeds with one sample each and five seeds
with five samples each both took about 240 s, because the diffusion samples are drawn in parallel on
the GPU while each seed re-runs the trunk. Twenty-five candidates is therefore upstream's default
sample count at no extra cost.

**The box passes its validation on these settings.** 2.151 A against the 3 A limit, pLDDT 0.933, and
two runs at one seed apart by 1.7 × 10⁻¹⁵ A — retained as
`runtime-boxes/measurements/protenix-base-v1-0-0-linux-x86_64-cuda12.6-development-2026-09-13.json`.

## Why the seed, and not the sampling

The seed drives the whole trajectory, the trunk included, so every sample drawn at one seed inherits
that seed's fate. Both cheaper remedies were measured and both failed:

- **More samples at one seed.** Five samples at seed 42 were all wrong, exactly as one was.
- **More recycling.** Doubling it from 10 to 20 on the three worst seeds moved them from
  13.32 / 13.00 / 12.95 A to 12.82 / 12.68 / 12.66 A. Still the wrong fold.

## Why determinism had to be switched on

Upstream ships `deterministic: False`, and its command line does not expose the flag, so it is set on
the configuration object before Protenix builds its runner; the box refuses to predict if that key
has gone. Without it, CUDA picks kernels whose summation order varies between processes, and a
diffusion model amplifies that difference: the same seed produced ubiquitin at 1.39 A twice and at
12.32 A once. With it on, three runs at one seed agreed to the last digit of pLDDT and RMSD.

## Why the confidence scale changed

Protenix reports pLDDT on 0 to 100; Boltz-2 reports it on 0 to 1. The shared contract's
`validateStructureModelRows` rejects a confidence outside 0 to 1, so the native value would have
failed validation the moment a product surface consumed it. The runner divides it down, and one
number now means one thing in both models.

## What this costs, stated plainly

A ubiquitin prediction takes about **240 s** against Boltz-2's **55 s**, and lands at
**1.77 – 1.90 A** against Boltz-2's **0.62 – 1.64 A** across the same eight seeds. Protenix is the
slower and, on this target, the slightly less accurate of the two. It earns its place by being
independent — a different architecture, a different team, a different training pipeline — not by
being better. Two models that agree is evidence; one model is a single point of failure.

**This is one protein.** Whether Protenix's alignment-free weakness is general or particular to
ubiquitin is not established, and a second reference structure is the way to find out.

## What was rejected

**Shipping the single-seed behaviour with a warning.** The warning is real and it fires correctly,
but handing a non-technical user a wrong fold half the time and relying on them to read a confidence
score is not a product.

**Changing the default seed to one that works.** Seed 101 happens to be good. Choosing it after
seeing the results would hide the problem behind a number, and any user who changed the seed would
walk straight back into it.

**Dropping Protenix.** Its failures are self-announced and now fixed, and a second independent
structure model is the whole reason it was picked.

**Selecting by our own quality measure instead of upstream's ranking score.** The box has no access
to an experimental structure at prediction time, which is the only thing that could tell it which
candidate is actually closer. Upstream's score is the honest instrument, and it separates the two
outcomes perfectly on every run measured here.

## Related

- [Protenix ships as base v1.0.0](./protenix-ships-v1-while-v2-waits.md) — which checkpoint this is.
- [Protenix resolves through PyPI](./protenix-resolves-through-pypi.md) — where the stack comes from.
