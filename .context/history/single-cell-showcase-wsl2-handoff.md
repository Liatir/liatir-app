# Single-cell study: Windows/WSL2 continuation

The user requested this transfer on 2026-10-05. The authoritative objective
remains [the complete study plan](./liatir_single_cell_showcase_codex_plan.md).
This historical handoff has been fulfilled; final closure evidence is in the [Windows/WSL2 execution record](./single-cell-showcase-wsl2-execution.md). Read the [execution record](./single-cell-showcase-execution.md)
and [showcase README](https://github.com/Liatir/liatir-app/blob/86a4542a2554032c8d1f79d6f07ef855e07af712/showcases/single-cell-foundation-benchmark/README.md)
for historical preparation details.
The user's later explicit PC resource authorization is recorded in the
[2026-10-05 resource decision](../decisions/2026-10-05-single-cell-pc-resources.md).
It supersedes this handoff's requirement to retain the Mac's execution limits
on the PC. Preserve all historical Mac resources and costs; use the new guarded
PC profile only for newly executed stages.

## Transfer contents

Code, small numerical records and these instructions travel on the Git branch
`handoff/single-cell-wsl2-2026-10-05` in `Liatir/liatir-app`.
Large scientific inputs and embeddings remain outside Git, as the study plan
requires. The separately copied archive is named
`single-cell-wsl2-handoff-2026-10-05.tar.gz`. The tracked
[transfer manifest](https://github.com/Liatir/liatir-app/blob/86a4542a2554032c8d1f79d6f07ef855e07af712/showcases/single-cell-foundation-benchmark/validation/windows-wsl2-handoff-manifest.json)
records its SHA-256, every included file, exclusions and verification outcome.

Copy that archive to the new checkout's ignored showcase `transfer` directory.
Verify its archive hash against the manifest, then extract into a new directory
inside `transfer`. Verify every extracted file against the recorded hash before
using any result. Extraction preserves two original native run output layouts:

- PBMC run `7afd5cd1-2911-45c7-be7f-28cb212734ca`: full 11,990 cells, five
  successful methods and the actual UCE memory-preflight failure; all final
  numerical scores, figures, configurations and logs.
- Pancreas run `6071da5e-c592-4ee3-8544-7bbe5b12be8f`: full 16,382 cells;
  complete PCA, Geneformer, Harmony and scVI embeddings with provenance and
  telemetry, plus the interrupted scGPT logs. No final pancreas metrics yet.

The archive also contains frozen run code, splits, exact prepared counts and
native screenshot/monitor evidence. The original public source cache is omitted
to preserve the Mac's 4 GiB minimum free disk. Download those sources again on
the PC and verify their recorded hashes before the independent source-count check;
do not recreate or change the transferred prepared counts merely for this check.
Redundant model-generated annotated count copies and the duplicate PBMC ZIP
are excluded; their original checksum records remain. Compact embeddings and
their actual prepared inputs are included. No installed model payload, Python
environment, Mac executable, credentials or private key is transferred.

## Verified state and limits

PBMC prepared SHA-256 is
`bd6aa9473c1895462cabff3cde087ba7776307103579ab2a77892269e6a99709`;
split SHA-256 is
`369daa5bc09ad8e32b7babc67e23068bfcd790d5eface55a63e7af63e4d69178`.
Pancreas prepared SHA-256 is
`aeb6f9a2de14b881a81420018963d2d35e33d705f01ecc73c11a78f012001368`;
split SHA-256 is
`194090a9d944c371e8df45f0795b9b05140b782d760c062c6e38d38f55abf0cd`.
Keep those exact transferred bytes. The pancreas source count layer contains
23,809,035 fractional entries; preserve them without rounding, along with its
explicit validated source attestation.

All original inference used Apple M1 / 16 GiB / macOS 14.4.1, CPU only, one
numerical thread, one-cell model batches, seed 23, the shared fixed 80/20 split
and unchanged signed model resources. The independent monitor enforces a
2 GiB process-family RSS ceiling, 2 GiB minimum host available memory, 4 GiB
minimum free disk and 256 MiB maximum swap growth. Do not silently relax these
limits, switch to Metal or change scientific parameters to accelerate completion.

The user authorized continuing on their PC, not paid compute, GPU CI, releases,
deployment or publishing. Inspect its RAM, disk, WSL limits and available model
targets before choosing a local execution path. Use the current signed catalog
and normal Liatir install/activation paths. Linux native runtimes differ from the
Mac payloads. In the catalog at handoff, scGPT has a Linux CPU target, Geneformer
has a Linux CUDA target and UCE has only a macOS target. Verify current exact
availability; do not claim that all three install in WSL or build/publish new
targets without authorization. Preserve genuine incompatibilities with evidence.

## Continuation order

1. Inspect the actual Windows/WSL checkout and hardware. Keep Linux source and
   data under its Linux home directory. Read repository policy and current state;
   verify the transfer before any expensive execution. Recreate Linux dependencies
   from the pinned requirements, never copy or resolve the Mac environment. Fetch
   the public original datasets into the source cache from the recorded URLs and
   verify their SHA-256 identities when source-preservation validation needs them.
2. Preserve the transferred roots as immutable historical evidence. Their
   absolute Mac paths are historical metadata, not paths to execute. Verify
   prepared counts, fixed splits, cell order and all nine completed embeddings.
   Do not rerun completed scientific stages merely to reconstruct missing UI state.
3. Repair durable per-batch scGPT saving and detach the native driver from the
   chat foreground process. Exercise a real interruption/resume on a tiny fixture
   and verify identical embeddings, strict identity rejection and cost accounting.
   Add this defect to the living checklist before running the full model again.
4. Implement a strict, explicit import/resume path through Liatir if required.
   The current UI accepts only a finalized run already known to its workspace;
   the archive alone does not populate the new machine's Jobs/run store. Do not
   fabricate Jobs or finalization. Keep the original run identity and Mac costs
   as source provenance; give new execution its own workspace/run/Job identities.
   The existing restore helper compares all frozen code, including reporting:
   the current renderer already differs from the pancreas checkpoint. Validate
   unchanged completed-stage identity without bypassing scientific checks.
5. Restart pancreas scGPT: its 65.6% progress is not a disk checkpoint. Retain
   the lost attempt separately. Resolve UCE only through a supported signed
   runtime and the unchanged budget, or retain a diagnosed blocker with nulls.
   Finish common evaluation, native Jobs/Results, plots and export for pancreas.
6. Assemble the two complete dataset results with the existing `assemble.py`.
   Run independent metric reproduction, exact source-count verification and
   `validate_artifacts.py`; retain their real JSON evidence. Visually inspect
   figures, including the corrected runtime-label layout. Update the draft
   results report from actual final tables and distinguish scVI training from
   zero-shot inference. Do not combine Mac and Linux timings into an unqualified
   same-host performance comparison. Record per-method host/runtime costs.
7. Complete `test:verify`, relevant native UI suites and `syngraphe check`.
   Update current context with concrete evidence and close/archive the plan only
   after every original completion criterion is met. Report exact commits,
   sources, completed/blocked methods, artifact paths and measured headlines.

## Remaining validation boundaries

Handoff verification on 2026-10-05 passed all seven `test:verify` gates:
85 unit files / 671 tests, process-family peak 1,700,282,368 bytes, no swap
growth. The archive passed SHA-256 checks for all 185 file members, both exact
prepared matrices and splits, and all nine completed embeddings. Its SHA-256 is
`2caacd2af314d5de0e3fbe8c02377fbff33af1d32846412db17eaa5a631e911b`,
size 246,562,756 bytes. `syngraphe check` passes; the authoritative plan's report
reference was qualified to its actual showcase location without changing any
scientific requirement. These are handoff checks, not study-completion evidence.

The latest seven-gate `test:verify` passed before transfer, including the three
standalone HTML export regressions. Scientific regressions passed 11 tests;
source counts were checked exactly for both datasets. The bundled full-PBMC
native UI and the native signal-termination regression passed.
Updated native packaging twice exceeded the Mac's unchanged 2 GiB cap; do not
repeat those builds here. The existing verified Rust bridge, executable SHA-256
`10ca77825884a8cdf6c861bc15b6dfc4eaa562ff575aea82ee8a6dad7308e0ea`,
was used with the supported local development frontend for pancreas.
Full pancreas completion, independent final reproduction, twelve-row assembly
and the broader relevant UI gates remain open. There is no final completion claim.


Closed on 2026-10-05. The original instructions and interrupted execution below/above are historical. The final [Windows/WSL2 execution record](./single-cell-showcase-wsl2-execution.md) and [report](https://github.com/Liatir/liatir-app/blob/86a4542a2554032c8d1f79d6f07ef855e07af712/showcases/single-cell-foundation-benchmark/report/results.md) document complete study delivery, validated reproduction and diagnosed UCE blockers.
