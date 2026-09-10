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

**Never anchor a test on a multi-line source snippet with a bare `\n`.** Only the paths listed in
`.gitattributes` carry `eol=lf`; everything else follows `* text=auto`, so a Windows checkout
(`core.autocrlf=true`) holds CRLF and a `\n` in an expected string stops matching without saying
why. The assertion then fails for the platform rather than for the thing it guards, and on
2026-09-10 one did exactly that. Normalise line endings when reading a source file to assert on it.

**Never cite a build artifact or a per-run report directory as a path.** `syngraphe check`
resolves every referenced path against the working tree, and a gitignored build output or a test
report written during one session exists on the machine that produced it and nowhere else. On
2026-09-08, moving development from macOS to the Windows/WSL2 host turned fourteen such references
into `LINK001` errors at once, and the check could not go green on the new machine while they
stood. The evidence those lines carry is still worth keeping — name the report by its timestamp
alone, the way "report `2026-09-07T14-45-29-324Z`" does, never as a directory the tool will try to
open, and keep the durable proof (hashes, run IDs, measured figures) in the sentence itself.

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
