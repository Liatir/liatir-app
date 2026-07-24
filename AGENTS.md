# AGENTS.md

Operational instructions for AI coding agents working in this repository.
Read this before implementing anything, and before proposing or building any multi-step LLM system.
This file is self-contained.

---

## Project context

We are developing **Liatir**, a **local-first** Rust/Tauri desktop app for bioinformatics. The goal is to build a production-grade scientific environment where native tools, visual pipelines, `.lia` Node/WASM plugins, API Connector, AI Models, and AI Tools work together through a **single shared I/O contract defined in `packages/liatir-core`**.

**Liatir is for non-technical users first — this is very important while designing and implementing anything.**

## Repository continuity

- The files that live in project-knowledge-base/ are an important part of your memory, and must be kept up to date.
- Always keep project-knowledge-base/current-project-status.md up to date.
- Durable project plans, implementation status, and handoff context required in Codespaces must live in tracked repository documentation, not only in machine-local agent memory.
- The canonical Runtime Box CI plan and current gate status live in `project-knowledge-base/roadmap/runtime-box-ci-foundation.md`. Read it before starting any Runtime Box CI gate and update it when a gate is completed or re-scoped.
- Machine-local memory may be used as a convenience, but it must not be the only source for information needed to continue repository work.

## Naming (canonical terms — use exactly these)

- **"Plugins"** means only `.lia` plugins.
- **"AI Models"** means locally installable/manageable model assets.
- **"AI Tools"** means AI capabilities exposed in pipelines.

## Architecture rules

- The general architecture must be **modular and scalable**, designed for order, maintainability, and long-term growth. Code and folders must stay organized, coherent, and easy to navigate.
- Heavy dependencies must be **modular and installed only when needed**, like separate boxes integrated through common standards.
- **Avoid manual duplicated types/contracts: the shared core (`packages/liatir-core`) must remain the source of truth.**

## Conventions

- **Language:** comments, UI text, code, CLI output, and developer-facing docs must always be in **English**.
- **Comments:** add explainer comments as a guide where they clarify non-obvious or big/complex logic, and small comments over any function about what it does — but don't generate too much comment noise.
- **DRY:** duplicated code must always be avoided unless there is truly no reasonable alternative. Prefer shared helpers, shared contracts, and existing local patterns over copy-pasted logic or parallel implementations.

## State & concurrency (ownership per entity)

Before implementing or modifying a feature, identify the **real entity that owns the state**: workspace, pipeline, pipeline run, tool run, AI model job, plugin run, dependency install, result artifact, etc. **Never use a single global state if the domain allows multiple concurrent or saved instances.**

For every run or process, always verify:
- stable parent identity;
- state separated per instance;
- behavior across page navigation;
- what happens when the user returns to the screen/page;
- how it appears in Jobs (if related);
- how it finalizes into Results (if related);
- correct logs, outputs, provenance, and parent association;
- inputs disabled only for the entity that is actually running (if relevant);
- no UI blocking for unrelated pipelines, tools, plugins, or models.

## Working principles

- Be **pragmatic but rigorous**: read the real repo, follow existing patterns, keep changes organized and verifiable.
- Do **NOT** introduce fake fallbacks or architectural shortcuts.
- Every feature must work well at **production level** — for real users, real files, and real scientific workflows, not only for the immediate demo.
- Before closing work, mentally and technically run automatic tests to check everything works correctly (see the verification gate under the architecture policy).

### Task-specific execution checklists

- For every medium-complexity or complex task, maintain a **living, task-specific internal checklist** while working. A user plan provides direction but cannot predict every implementation detail; convert discoveries, dependencies, and risks into explicit checklist items before proceeding.
- Refresh the checklist before each materially complex step. At minimum, verify: prerequisites and current state; the exact file, command, workflow, target, and inputs; expected state changes; success evidence; failure and stop conditions; rollback or cleanup; and any cost or authorization boundary.
- Never perform a paid, remote, publishing, release, deployment, destructive, or otherwise consequential action from memory or name inference alone. Read back the exact action definition and inputs, verify that they match the intended operation, and immediately verify the created action identity, revision, target, and mode. Stop or cancel on any mismatch.
- Mark an item complete only from concrete evidence such as a test result, generated artifact, run ID, receipt, diff, or observed state transition. Do not infer completion from an earlier adjacent step.
- When a new defect or unexpected condition appears, add it to the checklist with its root cause, regression coverage, required cheap rechecks, retry limit, and cleanup before attempting another expensive action.
- Keep the checklist proportional: concise for bounded work, more detailed for releases and multi-stage changes. Do not turn it into repetitive commentary or polling. For work that must survive another session, store the evolving checklist and evidence in the canonical tracked plan or handoff document.
- The checklist supplements, and never replaces, repository instructions, the user plan, architecture rules, or required tests.

### Long-running processes and monitoring

- **Never waste user credits or context on repetitive polling.** This applies to every long-running or external process, not only CI: builds, tests, deployments, jobs, downloads, services, queues, and remote workflows.
- Do not use verbose watch commands or repeated status calls that inject unchanged state into the conversation or context window.
- Prefer event-driven completion signals or a silent background wait. If neither exists, perform one concise status check after a meaningful interval and stop checking until another meaningful interval or a fresh user request.
- Report only real transitions: actionable progress, failure, completion, or a change that requires a decision. Never repeatedly report that a process is still running.

## Build / test / run

**Do not assume or hardcode commands — they change over time.** The authoritative commands live in the `scripts` sections of the `package.json` files in this repo. Before building, testing, running, or linting:
1. Read the root `package.json` and the `package.json` of the relevant workspace/package (e.g. `packages/*`), and use the scripts defined there.
2. For Rust crates, use the standard `cargo` commands per the relevant `Cargo.toml` (build/test/clippy).
3. If you're unsure which script applies, list the available scripts and pick the one whose name matches the intent (dev, build, test, lint) rather than inventing a command.

Run the appropriate test and lint scripts before declaring a task done.

## Boundaries — do not touch

Default boundaries (extend as needed for this repo):
- Generated bindings/types derived from `packages/liatir-core` — regenerate from the source of truth, never hand-edit.
- Lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `Cargo.lock`) unless the task is explicitly a dependency change.
- Secrets and environment files (`.env*`), credentials, signing keys.
- Build output and artifacts (`dist/`, `target/`, `build/`, bundled `.lia` outputs).

---

## Architecture policy: workflows and agents

**Rule zero — start simple.** Use the least complex option that solves the task. A single well-designed LLM call (with retrieval + a few examples) is often enough. Every added layer (workflow → agent → multi-agent) adds latency, token cost, and failure surface, and must be justified by a measurable gain. Do NOT add a second step/agent for "safety" or "completeness" if one step already works.

### Decision tree (stop at the first match)

1. Solvable in a **single call**? → use a single call. Build nothing more.
2. Steps **fixed and known in advance**? → use a **workflow** (chaining / routing). If you can draw the decision tree, implement it in code — more accuracy, more control, lower cost than any agent.
3. **Ambiguous** (can't pre-map steps) **but verifiable** (tests/compilation/clear criteria) **and high-value**? → consider an **autonomous agent** with verification. If not verifiable or low-value → stay on workflow/single call.
4. Decomposes into **independent, parallelizable, read-mostly** threads, or info **exceeds one context window**? → consider **multi-agent**. Otherwise → do NOT use multi-agent.

### Workflow patterns — use / avoid

| Pattern | Use when | Avoid when |
|---|---|---|
| **Prompt chaining** | Fixed, predictable subtasks; add gates between steps | Steps depend on input / not known ahead → orchestrator-worker |
| **Routing** | Distinct categories, accurate classification | Categories overlap or classifier unreliable |
| **Parallelization** (sectioning/voting) | Independent subtasks; multiple perspectives for confidence | Branches depend on each other, or outputs must merge into one written artifact |
| **Orchestrator-workers** | Can't predict which/how many subtasks (e.g. how many files to change) | Subtasks are always the same → static parallelization |
| **Evaluator-optimizer** | Clear eval criteria; iteration measurably improves output | No articulable quality criterion; single pass already good enough |

### Autonomous agent — all three must hold
1. **Ambiguous** (can't map the tree in advance)
2. **Verifiable** (cheap, reliable success signal — tests, compile, checker)
3. **Valuable** enough to justify ~4× token cost

Always set an **iteration cap**, an **explicit stop criterion**, and a **verification check every pass**. In a loop, each iteration multiplies the failure rate of the weakest link.

### Multi-agent — use only when ALL hold
- Threads are **genuinely independent** (no shared state needed)
- Threads are **mostly read/exploration** (reads parallelize; writes don't)
- Info **exceeds a single context window**
- **Value > cost** (~15× tokens)

**Do NOT use multi-agent when any of these is true:**
- Agents must **share context** or have **many mutual dependencies** (not a fit today)
- **Shared writing**: multiple agents edit the same artifact → conflicting implicit decisions that can't be merged
- **Strong sequential dependencies** (B needs A) → use a linear workflow / single agent
- The task is **already solved** by a single agent or workflow

If coordination is truly needed, go **linear**: agent 2 works with full knowledge of agent 1's output. Share full context and traces, not just messages.

### Red flags — stop if you see them
- Monolithic "do-everything" mega-prompt
- Over-engineered planning for a task a single call solves
- No tracing / correlation IDs before scaling complexity
- Parallelizing writes to the same artifact
- Agentic loops with no verification signal or no iteration cap
- Multi-agent debate/ensemble as a default (rarely beats single-agent at equal compute)
- Adding agents to fix a weak prompt (first ask if the agent is context-bound)

### Coding-agent specifics
1. **Default = linear single agent** for writing/editing/debugging code.
2. **Never spawn parallel subagents that write to the same codebase** — conflicting decisions (APIs, style, duplication) can't be merged cleanly. Delegate sequentially with full context handoff.
3. **Use subagents for read/exploration** (understanding code, locating bugs, gathering context across files), not parallel writes.
4. For changes touching an **unpredictable number of files**, use orchestrator-worker (discover files at runtime) but apply changes coordinated, not via independent parallel writers.
5. **Run build/tests/linter as a gate** after each significant step — this is also the "run automatic tests before closing" rule above. Get the commands from `package.json` / `Cargo.toml` as described in Build / test / run.
6. **Cap iterations**; if tests don't converge in N passes, stop and report.
7. Before choosing multi-agent, compare to a single agent at **equal token budget** — if the only gain is "more tokens," give a single agent more budget instead.

---

## Basis

The architecture policy above synthesizes: Anthropic "Building Effective Agents" and "How we built our multi-agent research system"; Cemri et al. "Why Do Multi-Agent LLM Systems Fail?" (MAST, arXiv:2503.13657); Tran & Kiela (arXiv:2604.02460); Cognition "Don't Build Multi-Agents"; LangChain "How and when to build multi-agent systems". Numeric figures (15×, 80%, 90.2%) are from specific evaluations, not universal constants.
