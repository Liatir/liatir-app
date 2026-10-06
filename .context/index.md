# Liatir Repository Context

`.context/` is the project's memory. Everyone who works on Liatir reads and
writes it — people and agents alike. It is not documentation *about* the work
kept to one side; it is where the work's decisions, state and hard-won lessons
live, so that neither a person returning after a month nor an agent starting a
fresh session has to re-derive them.

It is internal: the public documentation in `docs/` explains how to *use* Liatir
and is written for no-code users. `.context/` explains how Liatir is built and
maintained, and may go as deep as implementation details, state ownership, test
scripts and engineering constraints.

It is managed with [Syngraphe](https://syngraphe.dev): `syngraphe check` verifies
the context is initialized, structurally complete, internally consistent and
still current, and `syngraphe status` summarizes it. The context is plain
Markdown and stays complete and meaningful without the tool.

## Always relevant

- [`truth/architecture.md`](./truth/architecture.md) — core architecture
  principles, and the router into every deeper architecture document.
- [`truth/conventions.md`](./truth/conventions.md) — how this repository is
  worked in, including the rule that this directory is the only memory.
- [`state/current.md`](./state/current.md) — the canonical current project
  status and continuation order.

## When relevant

- `.context/state/roadmap/` — the live plans and ledgers: the
  canonical [Scientific AI Workbench product plan](./state/roadmap/scientific-ai-workbench.md),
  [Beta 1 readiness](./state/roadmap/beta-readiness.md), the
  [AI batch ledger](./state/roadmap/ai-batches.md), the
  [Runtime Box CI foundation](./state/roadmap/runtime-box-ci-foundation.md), the
  open [signed public distribution gate](./state/roadmap/release-signed-distribution.md),
  and the [Phase 3 implementation status](./state/roadmap/phase3-implementation-status.md),
  where OpenMM is still to publish.
- `.context/truth/` — what is stable: architecture, the `window.Liatir` and
  Rust command surfaces, AI Model and AI Tool boundaries, the testing strategy,
  and the working agreements addressed to agents.
- `.context/decisions/` — significant technical decisions with their
  rationale and what was rejected.

## Historical

- [Scientific Showcases documentation integration](./history/single-cell-showcase-docs-integration.md).

- [Completed single-cell study](./history/liatir_single_cell_showcase_codex_plan.md),
  [Windows/WSL2 execution evidence](./history/single-cell-showcase-wsl2-execution.md),
  and [final measured report](https://github.com/Liatir/liatir-app/blob/86a4542a2554032c8d1f79d6f07ef855e07af712/showcases/single-cell-foundation-benchmark/report/results.md).

- `.context/history/` — completed, superseded or closed operational
  context: the [status log](./history/status-log-2026-07-to-2026-09.md) that
  `state/current.md` accumulated until 2026-09-27, the gate evidence records, the
  closed [Scrollcase v3 adoption](./history/scrollcase-v3-adoption.md), the
  [Runtime Box production report](./history/runtime-box-production-report.md),
  the completed [pixi migration](./history/runtime-box-pixi-migration.md), and
  the completed [Scrollcase extraction](./history/scrollcase-extraction-plan.md)
  and [Liatir adoption](./history/scrollcase-p5-liatir-adoption.md) records.

## The rule

**A durable decision that is not written here does not exist.** It will be
re-derived, re-argued, and eventually reversed by accident. Write it down in the
same session you take it, and keep [current project status](./state/current.md)
true.

There is no separate agent memory. Nothing durable may live in a host-local note
file, an agent's private memory store, or a scratch directory: those are
invisible to everyone else and travel with no one. This is the one place.

## Running the site

`.context/` reads fine in an editor or on GitHub. It is also a VitePress site
when you want search and navigation:

- `npm run docs:internal:dev` — this site;
- `npm run docs:dev` — the public product documentation;
- `npm run docs:all:build` — both, before a larger documentation handoff.

Both sites use VitePress local search.
