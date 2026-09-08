# Memory

This repository has one memory: **`.context/`**.

Do not keep project memory here, in a host-local note file, or in any agent's
private memory store. This file used to hold a snapshot of the project's state;
it drifted out of date, which is exactly the failure a single shared memory
prevents.

- `.context/index.md` — the router into the context.
- `.context/state/current.md` — the canonical current project status.
- `AGENTS.md` — the operational rules every agent reads first.

`.context/` is managed with [Syngraphe](https://syngraphe.dev). Run
`syngraphe check` before completing substantial work.
