# Conventions

The day-to-day operating rules — invariants, build and test commands, safety
rules and boundaries — live in `AGENTS.md` at the repository root, because they
must be in context before any work starts. This document holds the conventions
that describe the repository itself and are read from here.

## Memory

`.context/` is the project's memory, and it is the only one. Durable plans,
implementation status, decisions and handoff context live here and nowhere else.

Never write project memory to an agent-local store outside this repository — not
a home-directory memory file, not a scratch directory, not any host-local note.
Such a memory is invisible to everyone else on the project, invisible to every
other machine and agent, and cannot be linked from a tracked document without
producing a dangling reference. If your harness offers a memory tool, do not use
it here.

Lifecycle, and where a new document belongs:

| Directory             | Lifecycle | Contents                                                               |
| --------------------- | --------- | ---------------------------------------------------------------------- |
| `.context/truth/`     | stable    | architecture, conventions, domain concepts, constraints, invariants    |
| `.context/state/`     | volatile  | current status, live plans and ledgers, next steps, blockers           |
| `.context/decisions/` | append    | significant technical decisions, their rationale and what was rejected |
| `.context/history/`   | archive   | completed, closed or superseded operational context                    |

A plan that closes moves from `.context/state/roadmap/` to `.context/history/` rather than being
deleted; the record of what was proven is what stops the same ground being
re-covered.

Run `syngraphe check` before completing substantial work. It verifies that the
context is initialized, structurally complete, that every path referenced from a
context document exists, and that the state document has not gone stale behind
the repository. See [syngraphe.dev](https://syngraphe.dev) for the finding codes.

## Naming (canonical terms — use exactly these)

- **"Plugins"** means only `.lia` plugins.
- **"AI Models"** means locally installable and manageable model assets.
- **"AI Tools"** means AI capabilities exposed in pipelines.
- Cloud AI stays out of the core unless the product direction changes.

## Language

Comments, UI text, code, CLI output, and developer-facing docs are always in
**English**.

## Documentation surfaces

- `.context/` — internal: how Liatir is built and maintained. May go as deep as
  implementation details, state ownership and engineering constraints.
- `docs/` — public: how to *use* Liatir, written for no-code users.
- `quenta-knowledge/` — curated scientific content.

`.context/` is also a VitePress site (`npm run docs:internal:dev`), so it stays
readable as plain Markdown but gains search and navigation when wanted.

## Working agreements for agents

[`agents/`](./agents/index.md) holds the operating rules that apply only to
autonomous agents — cost discipline, stop conditions, and the multi-step LLM
design policy. They are project knowledge like everything else here; they are
simply addressed to one kind of colleague.
