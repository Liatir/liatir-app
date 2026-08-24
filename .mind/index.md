# Liatir Mind

`.mind/` is the project's memory. Everyone who works on Liatir reads and writes
it — people and agents alike. It is not documentation *about* the work kept to
one side; it is where the work's decisions, state and hard-won lessons live, so
that neither a person returning after a month nor an agent starting a fresh
session has to re-derive them.

It is internal: the public documentation in `docs/` explains how to *use* Liatir
and is written for no-code users. `.mind/` explains how Liatir is built and
maintained, and may go as deep as implementation details, state ownership, test
scripts and engineering constraints.

## What belongs here

- architecture rules that affect multiple surfaces;
- testing and release checks;
- a beginner-friendly explanation of the
  [Runtime Box system](./architecture/runtime-box-system-explained.md);
- the canonical [current project status](./current-project-status.md) and
  continuation order;
- the canonical [Scientific AI Workbench product plan](./roadmap/scientific-ai-workbench.md);
- the evidence-backed [Runtime Box production report](./roadmap/runtime-box-production-report.md);
- the completed [Runtime Box pixi migration record](./roadmap/runtime-box-pixi-migration.md);
- the completed independent
  [Scrollcase extraction record](./roadmap/scrollcase-extraction-plan.md) and the
  completed downstream [Liatir adoption record](./roadmap/scrollcase-p5-liatir-adoption.md);
- AI Models and AI Tools roadmap status;
- Quenta and MCP trust boundaries;
- native bridge and runtime constraints;
- anything that stops the same mistake being made twice.

## The rule

**A durable decision that is not written here does not exist.** It will be
re-derived, re-argued, and eventually reversed by accident. Write it down in the
same session you take it, and keep [current project status](./current-project-status.md)
true.

There is no separate agent memory. Nothing durable may live in a host-local note
file, an agent's private memory store, or a scratch directory: those are
invisible to everyone else and travel with no one. This is the one place.

## Working agreements for agents

`.agents/` holds the operating rules that only apply to autonomous agents —
cost discipline, stop conditions, multi-step LLM design policy. They live inside
`.mind/` rather than beside it, because they are project knowledge too; they are
simply addressed to one kind of colleague. `AGENTS.md` in the repository root is
the entry point that points at them.

## Running the site

`.mind/` is plain Markdown and reads fine in an editor or on GitHub. It is also
a VitePress site when you want search and navigation:

- `npm run docs:internal:dev` — this site;
- `npm run docs:dev` — the public product documentation;
- `npm run docs:all:build` — both, before a larger documentation handoff.

Both sites use VitePress local search.

## Runtime Box ownership boundary

Scrollcase is an independent Apache-2.0 tool distributed through npm. It owns
the generic box contract, pixi/conda-pack build pipeline, signing envelope and
verification implementation. This repository consumes an exact published
version; it does not contain or develop Scrollcase source.

Liatir owns Runtime Box recipes, model-specific scientific validation,
runner/cost policy, evidence, its private signer adapter and key custody,
Registry/R2 distribution, trust roots, the Rust/Tauri installer, and product
Jobs/Results/provenance. Scrollcase is a build-time tool and never a runtime
dependency of the installed desktop application.
