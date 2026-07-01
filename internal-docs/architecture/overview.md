# Core Architecture Principles

Liatir is a local-first Rust/Tauri desktop app for bioinformatics. Native tools,
visual pipelines, `.lia` Node/WASM plugins, API Connector, AI Models, and AI
Tools must work through one shared I/O contract defined in
`packages/liatir-core`.

## Naming

- **Plugins** means only `.lia` plugins.
- **AI Models** means locally installable and manageable model assets.
- **AI Tools** means AI capabilities exposed in pipelines.
- Cloud AI stays out of the core unless the product direction changes.

## Shared contracts

`packages/liatir-core` is the source of truth for shared schemas, pipeline
types, AI model metadata, and cross-surface contracts. Do not mirror manual type
layers in the frontend, SDK, or plugin tooling when a generated or shared type
can be used.

When a shared contract changes:

1. Update `packages/liatir-core`.
2. Regenerate SDK-facing types with `npm run gen:sdk-types`.
3. Update consumers through the shared type shape, not duplicate mappings.
4. Add a focused contract test when the behavior can drift silently.

## Modular heavy dependencies

Heavy dependencies must be modular. Liatir should expose them as installable
capabilities that users bring in only when needed, similar to managed
Dependencies and AI Models. Avoid adding large viewer, runtime, or model
packages to the always-loaded frontend or core app unless they are genuinely
foundational.

## State ownership

Before implementing a workflow, identify the entity that owns state:

- workspace;
- pipeline;
- pipeline run;
- tool run;
- AI model job;
- plugin run;
- dependency install;
- result artifact.

Never use a single global state variable when multiple concurrent or saved
instances can exist. Variables named `running`, `selected`, `current`, `active`,
`status`, or `state` should be reviewed carefully. If the domain allows multiple
instances, the state usually needs to be keyed by a stable ID or persisted as a
first-class entity.

## Runtime behavior checklist

For every run or background process, verify:

- stable parent identity;
- state separated per instance;
- behavior across page navigation;
- what appears when the user returns to the screen;
- Jobs attribution during the run;
- Results finalization after completion;
- logs, outputs, provenance, and parent association;
- inputs disabled only for the entity that is actually running;
- no UI blocking for unrelated pipelines, tools, plugins, or models.

## User-facing quality

UI/UX is a core product concern. Do not expose ugly local absolute paths unless
the user explicitly needs them. Use path display helpers such as
`getLastSegmentsStringFromPath` or `sanitizeLocalPathsForDisplay` where local
paths may appear in tables, logs, errors, or tool output previews.

Features must work for real user files and real scientific workflows, not only
for demo cases.
