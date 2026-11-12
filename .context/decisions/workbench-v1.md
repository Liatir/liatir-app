# Workbench ownership and presentation boundaries

Accepted by the owner on 2026-11-11 for Liatir 1.0.0.

- **Plugins are app-global; executions are workspace-owned.** Preserve imported
  IDs during catalog migration because saved pipeline graphs already refer to
  them. Keep original catalogs for recovery and record migrated sources in the
  same atomic catalog write so removed imports are not resurrected. Existing
  bundle paths retain their previous meaning; this is not a new distribution
  or package-copying mechanism.
- **Python Scripts belong to one workspace.** Copying to another workspace
  creates a fresh independent identity without runs or Results. The shared core
  owns their schemas/API; the existing Python Plugin SDK validates every handler
  input/output. Each run snapshots source/contracts/dependencies into its own run
  folder (`runs/<id>/script/`) beside its durable working directory, so the copy
  lives and dies with the run. Packages are declared as plain requirement lines;
  installer options (anything starting with `-`) are refused. Keep JS/TS source as
  a read/export archive, without automatic translation or continued JS execution.
- **Leaving a workspace never silently cancels work.** Direct runs (tools, Plugins,
  Scripts, presentations) keep running and settle into the workspace captured when
  they started. Pipelines are still stopped on leaving, because their steps read
  workspace-scoped stores (API connections, external workflows) that a switch
  clears; the switch therefore asks for confirmation when a pipeline is running.
  A Sandbox reset clears only the active workspace's runs.
- **Quenta downloads are explicit.** Offer `qwen3.5:9b` for a 16 GB reference
  machine (Standard) and `qwen3.8:27b` for 32 GB (Extended); only choosing a
  profile downloads, users can switch profile or pick any installed Ollama model
  in settings, and a model chosen otherwise is kept. The plan asked for
  `gemma4:12b` as Standard; the owner-requested comparison (2026-11-11, 16 GB Mac,
  four Quenta-style questions) found similar answers but 9.56 vs 6.24 GiB and ~5
  vs ~9 tok/s, so the owner chose to keep `qwen3.5:9b`. Every request keeps
  Quenta's single 16,384-token context (`LIATIR_QUENTA_CONTEXT_TOKENS`); for
  gemma4 a smaller window saved only 0.18 GiB. `qwen3.8:27b` was not measured
  (does not fit 16 GB).
- **Presentations are a separate fixed workflow.** Read only selected scientific
  Result snapshots or, by owner request (2026-11-12), none: a free page about a
  described topic, written from general knowledge, stating so and marking every
  number or chart as an illustrative example. Generate Preact JavaScript/CSS,
  check rendering, and allow one repair. Do not introduce an autonomous agent or tools that execute analyses.
  Save the source snapshots, model identity, code/runtime and standalone HTML.
- **Generated code runs only in an opaque frame.** Supply local Preact and frozen
  source data. No app bridge, file gateway, external scripts/resources or network
  access. Restrict the parent frame policy too, since the child's policy alone
  cannot reliably prevent self-navigation. Standalone HTML carries both layers.
  Transfer plain JSON rather than reactive proxies and key previews by immutable
  presentation ID. Use replacement callbacks when embedding arbitrary source
  strings so literal dollar sequences cannot alter generated JavaScript.
- **Templates do not certify scientific studies.** Simulation presets reuse
  existing tool definitions and typed artifact handoffs, show platform/runtime
  requirements, and leave scientific choices explicit. Multi-hour workflow
  validation and publication are separate owner decisions.
