# Single-cell checkpoints and historical imports

Date: 2026-10-05. Scope: the authorized Windows/WSL2 continuation of the
[single-cell study](../state/liatir_single_cell_showcase_codex_plan.md).

scGPT commits each completed batch to a local SQLite database, using full
synchronous transactions, contiguous row ranges, float32 bytes and per-batch
SHA-256. A writer lock prevents two processes from owning the same saved
inference. Restore rejects changed inputs, cell order, model/source/runner
hashes, seed, settings, package versions, activation or host. This adds no
Python package to the signed model. Do not reconstruct values from progress
logs or claim unsaved work as a completed batch.

Checkpoint attempts retain their measured elapsed lower bounds and peaks.
An interrupted tail is not known; aggregate complete representation time
must be null with an explicit reason when it cannot be established. Original
Mac attempts remain separate from new PC attempts.

A detached Node supervisor owns each native driver, durable request, log and
actual exit record. Its process lifetime is independent of the chat launcher.
The native app still owns real workspace runs, child Jobs and Results.

The exact historical handoff is recognized by the tracked immutable transfer
manifest. Every transferred file is checked, and current common evaluation
code and pinned requirements must agree. Completed representations keep the
original frozen code, measurements, input/split/embedding identity and Mac
environment. A new import gets a fresh Liatir run and never fabricates old Jobs.
Historical presentation-only changes do not justify repeating inference or
disabling scientific checks. Other saved studies retain strict frozen-code
validation. Imports copy storage rather than creating writable hard-link aliases.

Per-method host identity belongs to the representation producer. Regenerating
a report on Linux must not relabel a Mac measurement. Mixed-host cost plots
cannot establish a same-host performance ranking.

The pinned scGPT JSON vocabulary loader repeatedly rebuilds the token index.
The PC runner instead uses the pinned public vocabulary constructors once in
the recorded index order and verifies every token-to-ID entry against the
original JSON. Nonconsecutive/noninteger IDs are rejected. Signed payloads
and model weights are unchanged; exact resumed embeddings are checked against
the unchanged frozen Mac runner on the same signed Linux CPU box. Original Mac
times include the old loader, so implementation as well as host differs.

Implementation and validation evidence live in the
[continuation checklist](../state/single-cell-showcase-wsl2-execution.md).
