# Working agreements for agents

Operating rules that apply specifically to autonomous agents working on Liatir.

They live inside `.context/` rather than beside it because they are project
knowledge like everything else here — they are simply addressed to one kind of
colleague. Anyone is welcome to read them, and a person reviewing an agent's work
will often want to.

`AGENTS.md` in the repository root is the entry point every agent reads first; it
covers the day-to-day operational rules and links here for the rest.

## What is here

- [Multi-step LLM systems](./multi-step-llm-systems.md) — how to choose between a
  single call, a workflow, an autonomous agent, and a multi-agent setup, and what
  must be true before adding a layer. Read it before proposing, designing or
  building any of them. It does not apply to ordinary code work.

## What does not belong here

Anything that a person on the project also needs in order to understand a
decision. That is ordinary project memory and belongs in the rest of `.context/`
— a live plan in `.context/state/roadmap/`, the current status, an architecture note, a
decision record. This folder is only for rules about *how an agent operates*,
not for what the project has decided.
