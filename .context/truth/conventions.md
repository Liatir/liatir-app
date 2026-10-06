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

The context manifest explicitly declares `"protocol": "repository-context"`, so Syngraphe
recognizes the context alongside its VitePress configuration and static assets. An outdated
managed agent block can be refreshed with `syngraphe init` after reviewing its `--dry-run`
plan: only the managed block may change, and existing context documents must remain untouched.

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
- **AI Models are listed, installed, updated and removed only on the AI Models page.** No other
  screen (Dependencies included) duplicates that list or its actions; another screen may link there.

## Language

Comments, UI text, code, CLI output, and developer-facing docs are always in
**English**.

## Documentation surfaces

- `.context/` — internal: how Liatir is built and maintained. May go as deep as
  implementation details, state ownership and engineering constraints.
- `docs/` — public: how to *use* Liatir, written for no-code users.
- `quenta-knowledge/` — curated scientific content.

Scientific Showcases are the public scientific-study exception to the usage-guide
surface: `docs/showcases/` presents measured methods, results and limitations;
`showcases/` holds the canonical technical packages. Large matrices, embeddings
and reproducibility archives stay outside Git and are linked through each study's
external artifact record. Public figure copies must remain byte-identical to the
validated figures in the technical package. Showcase pages belong in navigation,
`site-meta.ts` section metadata and both generated Quenta corpora; regenerate the
corpora and Markdown/LLM indexes rather than editing their output.

Showcase reproduction is a user workflow in the visual Liatir app. Explain the
main stages through AI Models, Tools, Jobs and Results; do not turn it into
terminal commands, environment setup or a developer verification guide. Prefer
stable workflow descriptions over detailed button sequences unless the interface
has been checked directly. Preserve the underlying scientific source and historical
validation evidence separately.

`.context/` is also a VitePress site (`npm run docs:internal:dev`), so it stays
readable as plain Markdown but gains search and navigation when wanted.

### Public Markdown and page actions

The public site's AI index (`/llms.txt`), combined text (`/llms-full.txt`) and one Markdown
copy per published page are generated by `docs/.vitepress/site-meta.ts` on every docs build.
Never maintain those copies by hand. A clean page URL gains `.md`; a directory index uses
its directory name plus `.md`, and the home page's `/index.md` contains the documentation
index. Excluded sources and the 404 page do not get copies. Code examples remain intact;
tab panels become titled sections and documentation links become absolute URLs.

`docs/markdown-path.mjs` is shared by the build and `docs/functions/_middleware.js`.
The latter serves Markdown when a reader explicitly sends `Accept: text/markdown`,
advertises the alternate representation and varies caching by `Accept`. API endpoints and
non-reading requests pass through. Missing Markdown assets never turn an HTML fallback
into a response mislabeled as Markdown.

`docs/.vitepress/theme/PageActions.vue`, registered in the theme's `doc-before` slot,
adds the Markdown Copy/View and Ask an AI menus to documentation pages. It reads the
generated alternate link; copying and viewing fetch the current site's copy, while AI
links and Copy prompt use the production URL. Provider prompt URL parameters belong to
the external services, so their acceptance cannot be guaranteed by this repository.

Verify the built site with `npm run docs:build` and `npm run docs:preview`: development
serving exposes source Markdown rather than the generated copies. The public site is a
browser-only surface, so headless browser checks cover its menus, clipboard, navigation
and narrow viewports; native desktop UI suites cover the app instead.

Cloudflare Pages installs only the independent `docs/package.json` and its lockfile.
Every package the docs build needs belongs there, including `markdown-it-mathjax3` while
`markdown.math` is enabled. A root build can silently find a root dependency and mask a
missing docs dependency. Verify deployment dependency changes in an isolated copy outside
the checkout: install only the docs lockfile with `npm ci`, then run `npm run build` from
the docs directory, including its prebuild step.

### Public legal pages and software licensing

Liatir's desktop application is licensed under GNU GPL v3; the repository's `LICENSE`
contains the license text. The public [Terms](https://liatir.com/terms) and
[Privacy Policy](https://liatir.com/privacy) link to the official GNU GPL v3 text;
their sources are `docs/terms.md` and `docs/privacy.md` in this repository.
Website terms, optional analytics consent and mailing list subscriptions must not
restrict the license's software rights. Website content restrictions exclude materials
covered by the GPL or another stated license, and the feedback clause does not relicense
code submissions. Website access restrictions do not revoke software licenses.

## Working agreements for agents

[`agents/`](./agents/index.md) holds the operating rules that apply only to
autonomous agents — cost discipline, stop conditions, and the multi-step LLM
design policy. They are project knowledge like everything else here; they are
simply addressed to one kind of colleague.
