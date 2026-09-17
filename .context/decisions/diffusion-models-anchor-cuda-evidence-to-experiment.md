# Diffusion models anchor CUDA evidence to an experimental structure

Taken 2026-09-17, when Protenix base v1.0.0's first production release could not write its evidence.

## Decision

A CUDA release's scientific evidence must show that the accelerator's result was checked against a
trusted reference. Until now the only accepted reference was a CPU baseline:
`parity.cpuBaselinePassed === true`. A structure model may instead declare
`parity.anchor: 'experimental-structure'`, and the evidence contract accepts it when that comparison
passed (`parity.passed === true`). `parity.acceleratorPassed === true` is still required in both
cases.

Boltz-2 and Protenix set the anchor. Their accelerator run is held to PDB 1UBQ, the experimentally
solved ubiquitin structure, by backbone RMSD against a 3 Å limit, and their repeat run at the same
seed must agree to 0.01 Å.

## Why

A CPU baseline is a parity check: the same computation on a trusted platform, compared value by
value. That works for a deterministic network such as scGPT or Geneformer, and for OpenMM's Reference
platform. It does not exist for a diffusion model. At the same seed, a CPU draws different noise from
a GPU, so the two produce different structures by construction; any CPU-versus-GPU comparison would
itself be a loose structural threshold, measuring nothing the experimental comparison does not.

The experimental structure is the stronger reference. It is not another run of the same code, and a
numerical fault on the accelerator that moved the result would move it away from experiment.

## What was rejected

**Running a CPU baseline anyway.** Protenix draws 25 structures per prediction; on CPU that is hours
per release, for a comparison that cannot be parity.

**Exempting CUDA structure models from the reference requirement.** That would let a release pass
with no check of the accelerator result at all.

**Assembling evidence for the two releases that were already promoted.** Boltz-2 run `35207954903`
and Protenix run `35218459568` promoted their boxes and then failed to write evidence. Their publish
and promotion receipts died with the ephemeral runner, and their validator outputs predate the
anchor. A record built by hand would claim a CI provenance nothing produced, so both are released
again.

## Related

- [Protenix competes seeds](./protenix-competes-seeds-because-one-is-a-coin-flip.md)
- [Linux GPU CI runs on the owner's machine](./linux-gpu-ci-on-the-owner-machine.md)
