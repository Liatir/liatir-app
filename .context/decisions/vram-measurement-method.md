# How VRAM is measured

Taken 2026-09-09, when the first GPU run in this project's history exposed that the existing method
silently reports zero on the only GPU host the project has.

## Decision

`scripts/runtime-box/measure-python.py` is shared by every scientific validator. It measures peak
GPU memory two ways, and always says which one produced a number:

1. **Per-process**, by summing `nvidia-smi --query-compute-apps` rows for its own PID. Unchanged,
   and still preferred wherever the driver reports it. Every existing CUDA evidence record — scGPT
   and Geneformer on native self-hosted runners — was produced this way and stays valid and
   comparable.
2. **Device-wide delta**, used only when the first yields nothing: total card usage sampled
   throughout the run, minus a baseline read before the workload creates its CUDA context.

Every sample carries `vramMeasurementMethod` and, for the fallback, `vramDeviceBaselineBytes`. The
label is not decoration: **a device-wide delta must never be compared against a per-process figure**,
and without the label the two are indistinguishable in a JSON file read months later.

The sampler also records `gpuName` and `gpuDriverVersion`, and the OpenMM validator writes them into
`evidence.accelerator`, which had been hard-coded `null`. A GPU number that does not name the card
and driver that produced it is not evidence anyone can act on.

Sampling waits 50 ms between rounds rather than 200 ms.

## Why

`nvidia-smi --query-compute-apps` returns an empty list under WSL2 — no rows, no error, exit code 0.
This was verified against a live CUDA context on 2026-09-09, not inferred from documentation. The
old code summed matching PIDs, found none, and returned zero, which is indistinguishable from a run
that never touched the GPU. Its guard for incapable drivers could not fire, because it only
triggers on a malformed row for a PID that is present.

That mattered the moment Windows-through-WSL2 became the only Windows path
([no native Windows Runtime Box targets](./no-native-windows-runtime-box-targets.md)) and the only
GPU machine in the project turned out to be a WSL2 host. Without the fallback, **no CUDA measurement
could ever be taken here**, and a measured hardware envelope is a precondition for publishing a GPU
target at all.

The 50 ms wait is a separate defect found in the same run. `nvidia-smi` costs about 80 ms per call,
so two calls plus a 200 ms wait sampled fewer than three times a second and missed the entire GPU
window of a run lasting about a second — which is how a 33-atom fixture failed while a 29,419-atom
one passed. This was never a WSL2-specific problem; native hosts sampled just as coarsely, and only
long workloads hid it.

## What was rejected

**Reading VRAM in-process through the CUDA driver API.** `cuMemGetInfo` costs microseconds instead
of 80 ms, but it needs a CUDA context in the calling thread, and retaining the primary context to
get one allocates GPU memory itself — corrupting the baseline it was meant to measure.

**Failing loudly and taking no CUDA measurement under WSL2.** Honest, but it leaves the project
permanently unable to measure a GPU target on the only GPU machine it has.

**Silently substituting device-wide numbers under the same field name.** This is the dangerous
option and the reason the method label exists: it would quietly make new records incomparable with
the ones behind already-published components.

## A device-wide delta may back a published figure — confirmed 2026-09-09

The owner accepted it the same day, and the reasoning is worth keeping: a device-wide delta charges
a run for everything the card gained while it ran, the Windows desktop included, so it can only
over-state. For a *minimum* VRAM figure that is the safe direction — it asks a user for more
headroom than the run strictly needs, never less. It stays a coarser quantity than the per-process
figures behind the published components, which is exactly why the method label travels with every
sample rather than being inferred later.

Registered on that basis: `openmm-8.5.1-beta.1-linux-x86_64-cuda12.9-development-2026-09-09` in
`LIATIR_PHASE3_HARDWARE_VALIDATION_PROFILES`, transcribed from its retained measurement. Its
measured peak of 193,986,560 bytes gives a published minimum of 242,483,200 and a recommended
290,979,840 through the standing ×1.25 and ×1.5 rule.

`tests/unit/phase3-hardware-profiles.test.ts` compares every profile's samples byte-for-byte against
its evidence record and pins those three VRAM figures. Both halves were observed failing: changing a
single byte of one sample broke the transcription check and the published-figure check together.

## Records

- [Phase 3 implementation status](../state/roadmap/phase3-implementation-status.md) — the OpenMM
  CUDA evidence this came out of, and the measured figures.
