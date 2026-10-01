# AGENTS.md

<!-- syngraphe:start version="1" -->
<!-- Managed by Syngraphe. Do not edit this block manually. -->

This repository maintains shared project context in `.context/`.

Before substantial work, read `.context/index.md` and the relevant context documents.
Keep that context accurate: when a change makes it out of date, update it in the same change.
If Syngraphe is available, run `syngraphe check` before completing substantial work.
If `AGENT-POLICY.md` is present, read it before planning multi-step or expensive work.
<!-- syngraphe:end -->

Operational instructions for AI coding agents working in this repository. Read this before implementing anything.

**Liatir** is a **local-first** Rust/Tauri desktop app for bioinformatics: native tools, visual pipelines, `.lia` Node/WASM plugins, API Connectors, AI Models and AI Tools, all speaking a single shared I/O contract.

**Liatir is for non-technical users first.** This outranks technical elegance in every UX decision.

---

## Answering in chat (non-negotiable)

The person you are working with owns the product; they are not a bioinformatician.
Long, dense, jargon-heavy answers have repeatedly cost real time and money in useless
back-and-forth. These rules outrank your instinct to be thorough.

- **Short by default.** A few lines. No long reports, no walls of text, no exhaustive
  option surveys in chat. Detail is given only when it is explicitly asked for.
- **Explain every term the moment you use it**, in one plain sentence, as you would to a
  child. Never assume a tool name, a file format, a data structure or an acronym is
  understood. If you cannot explain it simply, you do not understand it well enough to
  recommend it.
- **Always give your recommendation and the reason.** Never present two or three options
  and stop. They are asking precisely because they do not have the technical background
  to choose; handing the choice back unanswered is a failure, not neutrality.
- **Answer the question that was asked.** Do not start work, measurements, builds or
  edits when the question was "are you ready?" or "what do you think?".
- **Write durable decisions into `.context/`** so they are never re-derived or re-argued in
  a later session.

## Memory lives in this repository, and nowhere else

**Never write anything to an agent-local memory store outside this repository.** Not
`~/.claude`, not a scratch directory, not any host-local note file. The only memory is
`.context/`, which is tracked, reviewable, and travels with the code.

An agent-local memory is invisible to everyone else on the project, invisible to every
other machine and agent, and cannot be linked from a tracked document without producing
a dangling reference. If you learn something durable — a decision, a constraint, a
preference, a measured fact — it goes in `.context/` in the same turn you learn it. If your
harness offers a memory tool, do not use it here.

`.context/` is managed with **Syngraphe** (`syngraphe`, or the shorthand `syg`) — a small
offline command-line tool that keeps repository context versioned and verifiable; see
[syngraphe.dev](https://syngraphe.dev). It does not own the content: the directory is plain
Markdown and stays complete without it. Place a new document by lifecycle, not by topic:

- `truth/` — stable: architecture, conventions, domain concepts, constraints, invariants.
- `state/` — volatile: `current.md` is the canonical project status; `state/roadmap/` holds
  the plans and ledgers that are still live.
- `decisions/` — append-only: a significant technical decision, why it was taken, and what
  was rejected.
- `history/` — archive: completed, closed or superseded operational context. A plan that
  closes moves here; it is never deleted.

Run **`syngraphe check`** before completing substantial work. It is deterministic and
offline: it fails when a context document points at a path that does not exist, and warns
when `state/current.md` has gone stale behind the repository. `syngraphe status` summarizes
the context. On an existing context, use `syngraphe init` only to refresh an outdated managed
agent block after inspecting `syngraphe init --dry-run`. The plan must leave existing context
documents unchanged; never use initialization to replace project knowledge.

## Naming (canonical terms — use exactly these)

- **"Plugins"** means only `.lia` plugins.
- **"AI Models"** means locally installable/manageable model assets.
- **"AI Tools"** means AI capabilities exposed in pipelines.

## Invariants

Things that must stay true after your change. If one of them is in the way, stop and ask — do not work around it.

- **`packages/liatir-core` is the single source of truth for shared types and contracts.** Never hand-write a parallel type in the frontend, in `src-ts`, or in Rust. Generated artifacts (`frontend/src/lib/liatir-sdk-types.ts`, `frontend/src/lib/liatir-completions.generated.ts`) come from `npm run gen:sdk-types` — regenerate, never edit.
- **The app must keep working offline.** `services/runtime-box-signer` and `workers/runtime-box-registry` are build and distribution infrastructure. They must never become a runtime dependency of running a pipeline, a tool, or an installed AI Model.
- **Heavy dependencies stay modular and installed on demand.** Nothing heavy may become mandatory for app start, or for a workflow that doesn't use it. Boxes integrate through common standards; they are never wired into the core.
- **A change to the native bridge crosses three surfaces** — `src-tauri/src/bridge/*.rs`, `src-ts/`, `frontend/src/lib/`. Keep them consistent through the shared contract; a new Rust command with no matching contract update is an incomplete change.
- **Runtime Box identity is a contract.** `runtime-boxes/target-id-contract.json`, `catalog.json`, `trust/` and `evidence/` are tracked data that other machines and CI depend on. Changing a target ID, a catalog entry, or a trust root invalidates existing boxes — treat it as a breaking change, never as cleanup.
- **Correctness before convenience.** Never keep a faster or simpler path that produces unexplained differences in scientific output, provenance, or logs.

## State & concurrency (ownership per entity)

Before implementing or modifying a feature, identify the **real entity that owns the state**: workspace, pipeline, pipeline run, tool run, AI Model job, plugin run, dependency install, result artifact. **Never use a single global state if the domain allows multiple concurrent or saved instances.**

For every run or process, verify:

- stable parent identity;
- state separated per instance;
- behavior across page navigation, and on returning to the screen;
- how it appears in Jobs, and how it finalizes into Results (if related);
- correct logs, outputs, provenance, and parent association;
- inputs disabled only for the entity that is actually running;
- no UI blocking for unrelated pipelines, tools, plugins, or models.

## Layout

- `src-tauri/` — the Rust/Tauri app. `src/bridge/*.rs` is one file per native capability (`jobs`, `files`, `deps`, `ai_runtime`, `lia_plugins`, …) and is the main IPC surface; `src/helpers/` holds shared Rust logic. `tauri.conf.json`, `capabilities/` and `permissions/` are generated from `conf-templates/` by the `*conf` scripts.
- `packages/` — `liatir-core` (shared contracts: `runtime-box.ts`, `ai-catalog.ts`, `native-tools.ts`, `quenta.ts`), plus `liatir-api`, `liatir-cli`, `liatir-output-parser`. These are published npm packages.
- `frontend/` — SvelteKit UI. `src/lib/` holds components, `stores/`, `pipeline/`, `ai/`, `tools/`, `quenta/`, `viewers/`.
- `src-ts/` — the TypeScript side of the bridge and the plugin-facing runtime (`core/`, `liatir/`, `modules/`).
- `sdk/`, `public-sdk/`, `wasm-modules/` — the plugin SDK, its published surface, and WASM tool modules.
- `runtime-boxes/scrolls/native-tools/` — the committed Scrollcase scrolls and locks for the single
  Native Tools box that ships inside the app. Built signed box resources live under
  `src-tauri/resources/native-tools/`, are produced by `npm run native-tools:build`, and are never
  committed.
- `runtime-boxes/` — Runtime Box data: `recipes/`, `catalog.json`, `trust/`, `evidence/`, `measurements/`, `legal/`. `infra/runtime-box-ci/` is the CI side; `services/runtime-box-signer` and `workers/runtime-box-registry` are the remote services.
- `scripts/` — build, conf, publishing and Runtime Box orchestration entry points behind the npm scripts.
- `tests/` — `unit/` (vitest), `e2e/` (a real compiled binary driven over WebDriver), and `test-matrix.mjs`, which declares every suite and profile as data.
- `.context/` — the project's memory: internal knowledge shared by people and agents (see Repository continuity), with `truth/agents/` for agent-specific working agreements. `docs/` is the public product site. `quenta-knowledge/` is curated scientific content.

This list is not complete — read the files for more.

## Build / test / run

These are the current commands. If one no longer exists, read the `scripts` section of the root `package.json` (or of the relevant workspace) **and update this file**, rather than leaving the next agent to rediscover it.

- `npm run dev` — run the app in development. `npm run dev:frontend` for UI-only work.
- `npm run build:dev` / `npm run build` — dev and production builds.
- `npm run native-tools:build` — build the bundled Native Tools Scrollcase box for this host. A
  production build and `test:tauri:prepare` run it and a packaging gate fails without it
  (`native-tools:require`). Windows cannot build it — only Linux can link a Linux conda prefix — so
  there it verifies the Linux box and its WSL2 Scrollcase consumer instead, and building it means
  running this inside WSL2.
  `npm run dev` does **not** build it: a debug binary finds whatever is already in
  `src-tauri/resources/native-tools/`, and with nothing there the bundled tools fall through to
  `PATH` exactly as they did before bundling. Build it once and dev matches production; the
  Dependencies screen shows which of the two you are on.
- `npm run test:fast` — unit and contract tests. Use this while working.
- `npm run test:verify` — **the gate before declaring work done**: unit + SDK type generation + core build + frontend check/build + `src-ts` compile.
- `npm run test:ui` — end-to-end against a real compiled binary. `npm run test:ui:visual` for visual snapshots.
- `npm run lint:ts`, plus `cargo clippy` / `cargo test` inside `src-tauri/` for Rust work.
- `npm run desktop-release:build` — the signed release build for this host (macOS: signed and
  notarized; Linux: updater-signed packages). Add `-- --msix` on Windows for the Microsoft Store
  package, which carries no in-app updater. It refuses to start without every release input and
  never publishes. All three — macOS (signed and notarized), Linux and the Store package — are
  normally built by the hand-dispatched `desktop-release-build.yml` workflow (`targets: all`).
- `npm run desktop-beta:package:<macos|windows|linux>` and
  `npm run desktop-beta:test:<macos|windows|linux>` — the per-platform Gate 7 desktop package and
  install-lifecycle gates. Each refuses to run off its own platform, and every artifact they build
  is deliberately unsigned and must never be published.
- The `*conf` scripts run through `node scripts/run-conf.mjs <name>-conf.sh`, which resolves a real
  POSIX shell. On Windows they need Git for Windows and `jq`; the `bash` on PATH there is the WSL
  launcher and is deliberately not used.

Run `test:verify` before closing any task, and add `test:ui` when you touched UI, navigation, or the job/results lifecycle. Never mark work done on the strength of a successful build alone.

## Safety

Learned the hard way. These are not style preferences.

- **GPU CI runners cost real money.** Never trigger, re-run, or "just try" a GPU Runtime Box workflow to see what happens. Prepare the change so the first run passes, and ask before launching one.
- **Heavy AI tests download and run real models** (`test:heavy:ai`, `LIATIR_RUN_HEAVY_AI=1`, `--include-heavy`). Do not run them casually, and never as a substitute for `test:verify`.
- **Never perform a paid, remote, publishing, release, deployment, or destructive action from memory or name inference.** Read back the exact action definition and its inputs, confirm they match the intent, then immediately verify the created identity, revision, target and mode. Stop or cancel on any mismatch.
- **Windows CUDA is currently out of CI** (the hosted runner driver is too old for the required CUDA version). Do not "fix" it by loosening version constraints; see `.context/state/roadmap/runtime-box-ci-foundation.md`.

## Boundaries — do not touch

- Generated bindings and types derived from `packages/liatir-core` — regenerate from the source of truth.
- Lockfiles (`package-lock.json`, `Cargo.lock`) unless the task *is* a dependency change.
- Secrets, `.env*`, credentials, signing keys, and `trust/` roots.
- Build output and artifacts (`dist/`, `target/`, `build/`, bundled `.lia` outputs).

## Quality rules

- **Keep the implementation small, sharp, and easy to understand.** Don't settle for the first design that comes to mind; look for the minimal one that actually works. No slop: no fragile code that patches a single case, no dead code, no machinery more complicated than the problem it solves.
- **No fake fallbacks, no architectural shortcuts.** A path that silently pretends to succeed is worse than a visible failure.
- **DRY.** Prefer shared helpers, shared contracts, and existing local patterns over copy-pasted logic or a parallel implementation, unless there is genuinely no reasonable alternative.
- **Comments explain why** — a non-obvious ordering, a lifetime, a state-ownership choice, a scientific constraint. A short comment above a function saying what it does is welcome; commentary noise is not.
- **Language:** comments, UI text, code, CLI output, and developer-facing docs are always in **English**.
- Keep folders and modules organized and coherent. The architecture must stay modular and navigable as it grows.

## Repository continuity

- `.context/` is the project's memory, shared by everyone who works on Liatir — people and agents alike. It is not decoration. Keep `.context/state/current.md` up to date, and run `syngraphe check` before closing substantial work.
- Durable plans, implementation status, and handoff context live there and nowhere else. There is no separate agent memory: see "Memory lives in this repository, and nowhere else" above.
- The canonical Runtime Box CI plan and gate status live in `.context/state/roadmap/runtime-box-ci-foundation.md`. Read it before starting a Runtime Box CI gate, and update it when a gate is completed or re-scoped.

## Working discipline

- For medium or complex tasks, keep a **living internal checklist**: prerequisites and current state, the exact file/command/target and its inputs, expected state change, success evidence, stop conditions, rollback or cleanup. Refresh it before each complex step. Keep it proportional — a working tool, not commentary.
- **Mark an item done only from concrete evidence**: a test result, an artifact, a run ID, a diff, an observed state transition. Never infer completion from an adjacent step.
- **Never poll.** For any long-running process — build, test, deploy, job, download, CI — prefer an event-driven signal or a silent background wait. If neither exists, do one status check after a meaningful interval, then stop. Report only real transitions: actionable progress, failure, completion, or a decision you need. Never repeatedly report that something is still running.
- When a new defect appears, add it to the checklist with its root cause, the regression coverage it needs, a retry limit, and cheap rechecks, before attempting another expensive action.

## Designing multi-step LLM systems

**Before proposing, designing, or building any multi-step LLM system — a workflow, an autonomous agent, a multi-agent setup, or AI Tool orchestration — read `.context/truth/agents/multi-step-llm-systems.md` first.** It is not needed for ordinary code work; skip it otherwise. The rest of `.context/truth/agents/` holds the other agent-specific working agreements.
