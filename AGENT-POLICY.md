# AGENT-POLICY.md

How to decide the shape of a multi-step LLM system in this repository: workflow, autonomous agent, or multi-agent.

Read this **before proposing, designing, or building** any of the following:

- an AI Tool that orchestrates more than one model call;
- a pipeline step that plans, retries, critiques, or delegates;
- an agentic loop of any kind, in the product or in the development process;
- a proposal to split work across multiple agents.

It does not apply to ordinary code work. `AGENTS.md` remains the operational file for that.

---

## Rule zero — start simple

Use the least complex option that solves the task. A single well-designed LLM call (with retrieval and a few examples) is often enough. Every added layer — workflow → agent → multi-agent — adds latency, token cost, and failure surface, and must be justified by a measurable gain.

Do **not** add a second step or a second agent for "safety" or "completeness" if one step already works.

## Decision tree (stop at the first match)

1. Solvable in a **single call**? → use a single call. Build nothing more.
2. Steps **fixed and known in advance**? → use a **workflow** (chaining / routing). If you can draw the decision tree, implement it in code: more accuracy, more control, lower cost than any agent.
3. **Ambiguous** (can't pre-map the steps) **but verifiable** (tests, compilation, clear criteria) **and high-value**? → consider an **autonomous agent** with verification. If it isn't verifiable, or isn't valuable enough → stay on a workflow or a single call.
4. Decomposes into **independent, parallelizable, read-mostly** threads, or the information **exceeds one context window**? → consider **multi-agent**. Otherwise → do not use multi-agent.

## Workflow patterns — use / avoid

| Pattern | Use when | Avoid when |
|---|---|---|
| **Prompt chaining** | Fixed, predictable subtasks; add gates between steps | Steps depend on the input, or aren't known ahead → orchestrator-workers |
| **Routing** | Distinct categories, accurate classification | Categories overlap, or the classifier is unreliable |
| **Parallelization** (sectioning / voting) | Independent subtasks; multiple perspectives for confidence | Branches depend on each other, or outputs must merge into one written artifact |
| **Orchestrator-workers** | Can't predict which or how many subtasks (e.g. how many files to change) | Subtasks are always the same → static parallelization |
| **Evaluator-optimizer** | Clear eval criteria; iteration measurably improves the output | No articulable quality criterion; a single pass is already good enough |

## Autonomous agent — all three must hold

1. **Ambiguous** — you cannot map the decision tree in advance.
2. **Verifiable** — there is a cheap, reliable success signal (tests, compile, checker).
3. **Valuable** enough to justify roughly 4× the token cost.

Always set an **iteration cap**, an **explicit stop criterion**, and a **verification check on every pass**. In a loop, each iteration multiplies the failure rate of the weakest link.

## Multi-agent — use only when ALL hold

- Threads are **genuinely independent** (no shared state needed).
- Threads are **mostly read / exploration** — reads parallelize, writes don't.
- The information **exceeds a single context window**.
- **Value > cost** (roughly 15× tokens).

Do **not** use multi-agent when any of these is true:

- Agents must **share context**, or have many mutual dependencies.
- **Shared writing**: several agents edit the same artifact, producing conflicting implicit decisions that cannot be merged.
- **Strong sequential dependencies** (B needs A) → use a linear workflow or a single agent.
- The task is **already solved** by a single agent or a workflow.

If coordination is genuinely needed, go **linear**: agent 2 works with full knowledge of agent 1's output. Share full context and traces, not just messages.

## Red flags — stop if you see them

- A monolithic "do-everything" mega-prompt.
- Over-engineered planning for a task a single call solves.
- No tracing or correlation IDs before scaling up complexity.
- Parallelized writes to the same artifact.
- Agentic loops with no verification signal, or no iteration cap.
- Multi-agent debate or ensembles as a default — they rarely beat a single agent at equal compute.
- Adding agents to compensate for a weak prompt. First ask whether the agent is actually context-bound.

## Coding agents specifically

1. **Default to a linear single agent** for writing, editing, and debugging code.
2. **Never spawn parallel subagents that write to the same codebase.** Conflicting decisions about APIs, style, and duplication cannot be merged cleanly. Delegate sequentially, with a full context handoff.
3. **Use subagents for reading and exploration** — understanding code, locating a bug, gathering context across files — not for parallel writes.
4. For changes touching an **unpredictable number of files**, use orchestrator-workers to discover the files at runtime, but apply the changes in a coordinated way, not through independent parallel writers.
5. **Run build, tests, and linter as a gate** after each significant step. The commands are in the Build / test / run section of `AGENTS.md`.
6. **Cap iterations.** If the tests don't converge within N passes, stop and report.
7. Before choosing multi-agent, compare it against a single agent at **equal token budget**. If the only gain is "more tokens", give a single agent more budget instead.

## Basis

This policy synthesizes: Anthropic, "Building Effective Agents" and "How we built our multi-agent research system"; Cemri et al., "Why Do Multi-Agent LLM Systems Fail?" (MAST, arXiv:2503.13657); Tran & Kiela (arXiv:2604.02460); Cognition, "Don't Build Multi-Agents"; LangChain, "How and when to build multi-agent systems". The numeric figures (4×, 15×) come from specific evaluations, not universal constants.
