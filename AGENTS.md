# AGENTS.md

Operational instructions for AI coding agents working in this repository. Read this before implementing anything.

**Liatir** is a **local-first** Rust/Tauri desktop app for bioinformatics: native tools, visual pipelines, `.lia` Node/WASM plugins, API Connectors, AI Models and AI Tools, all speaking a single shared I/O contract.

**Liatir is for non-technical users first.** This outranks technical elegance in every UX decision.

---

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
- `native-tools-env/` — the committed `pixi.toml`/`pixi.lock` for the Native Tools environment that
  ships inside the app. The built environment is an archive under `src-tauri/resources/native-tools/`,
  produced by `npm run native-tools:build` and never committed.
- `runtime-boxes/` — Runtime Box data: `recipes/`, `catalog.json`, `trust/`, `evidence/`, `measurements/`, `legal/`. `infra/runtime-box-ci/` is the CI side; `services/runtime-box-signer` and `workers/runtime-box-registry` are the remote services.
- `scripts/` — build, conf, publishing and Runtime Box orchestration entry points behind the npm scripts.
- `tests/` — `unit/` (vitest), `e2e/` (a real compiled binary driven over WebDriver), and `test-matrix.mjs`, which declares every suite and profile as data.
- `project-knowledge-base/` — internal maintainer docs (see Repository continuity). `docs/` is the public product site. `quenta-knowledge/` is curated scientific content.

This list is not complete — read the files for more.

## Build / test / run

These are the current commands. If one no longer exists, read the `scripts` section of the root `package.json` (or of the relevant workspace) **and update this file**, rather than leaving the next agent to rediscover it.

- `npm run dev` — run the app in development. `npm run dev:frontend` for UI-only work.
- `npm run build:dev` / `npm run build` — dev and production builds.
- `npm run native-tools:build` — build the bundled Native Tools environment for this host. A
  production build runs it (as `native-tools:require`) and fails without it. Windows cannot build
  it — only Linux can link a Linux conda prefix — so there it verifies the archive instead.
- `npm run test:fast` — unit and contract tests. Use this while working.
- `npm run test:verify` — **the gate before declaring work done**: unit + SDK type generation + core build + frontend check/build + `src-ts` compile.
- `npm run test:ui` — end-to-end against a real compiled binary. `npm run test:ui:visual` for visual snapshots.
- `npm run lint:ts`, plus `cargo clippy` / `cargo test` inside `src-tauri/` for Rust work.
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
- **Windows CUDA is currently out of CI** (the hosted runner driver is too old for the required CUDA version). Do not "fix" it by loosening version constraints; see `project-knowledge-base/roadmap/runtime-box-ci-foundation.md`.

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

- `project-knowledge-base/` is authoritative memory, not decoration. Keep `current-project-status.md` up to date.
- Durable plans, implementation status, and handoff context must live in tracked repository docs. Machine-local agent memory is a convenience, never the only source for continuing work.
- The canonical Runtime Box CI plan and gate status live in `project-knowledge-base/roadmap/runtime-box-ci-foundation.md`. Read it before starting a Runtime Box CI gate, and update it when a gate is completed or re-scoped.

## Working discipline

- For medium or complex tasks, keep a **living internal checklist**: prerequisites and current state, the exact file/command/target and its inputs, expected state change, success evidence, stop conditions, rollback or cleanup. Refresh it before each complex step. Keep it proportional — a working tool, not commentary.
- **Mark an item done only from concrete evidence**: a test result, an artifact, a run ID, a diff, an observed state transition. Never infer completion from an adjacent step.
- **Never poll.** For any long-running process — build, test, deploy, job, download, CI — prefer an event-driven signal or a silent background wait. If neither exists, do one status check after a meaningful interval, then stop. Report only real transitions: actionable progress, failure, completion, or a decision you need. Never repeatedly report that something is still running.
- When a new defect appears, add it to the checklist with its root cause, the regression coverage it needs, a retry limit, and cheap rechecks, before attempting another expensive action.

## Designing multi-step LLM systems

**Before proposing, designing, or building any multi-step LLM system — a workflow, an autonomous agent, a multi-agent setup, or AI Tool orchestration — read `AGENT-POLICY.md` first.** It is not needed for ordinary code work; skip it otherwise.
