# Component Boxes

Liatir should behave as an organizer of contained boxes. Each box owns one
concept, one state boundary, and one failure boundary. Boxes communicate through
shared Liatir contracts instead of reaching into each other directly.

## Shared contract

Every executable node must expose the shared pipeline contract from
`packages/liatir-core`:

- typed input schema;
- typed output schema;
- output files;
- result sections;
- metrics and values;
- logs;
- provenance.

The contract is shared. Runtime state is not.

## Box boundaries

Use the narrowest owner that matches the domain:

- workspace state belongs to the workspace;
- pipeline state belongs to a `pipelineId`;
- pipeline run state belongs to a `pipelineRunId`;
- tool run state belongs to a tool run or analysis run;
- AI runtime state belongs to a `runtimeId`;
- AI model assets belong to a model-specific cache inside that runtime;
- viewer runtime state belongs to a viewer runtime id;
- dependency state belongs to the dependency manager.

Do not add a single global `running`, `selected`, `current`, `active`, or
`status` value unless the domain is truly singleton.

## AI boxes

AI has three separate layers:

- AI Model: installable local model/runtime asset.
- AI Tool: pipeline capability that uses compatible AI Models.
- AI runtime: a signed, isolated Runtime Box under
  `data/ai-runtimes/<runtimeId>`.

The model registry describes signed Runtime Box metadata. The artifact registry
describes runtime family and model entry assets. Tools must consume these
registries rather than duplicating model identifiers.

For AI Model runtimes:

- every installable model must have an artifact spec;
- every managed runtime must have `runtimeId`, `runtimePackages`, and
  `modelCacheSubdir`;
- a shared `runtimeId` is allowed only when package and host requirements are
  identical;
- scripts should live with the tool/family that owns them;
- every catalog entry must expose at least one published native target.

All product AI runtimes use the signed AI Runtime Box distribution path:

- immutable ZIP archive with standalone Python, exact hash-locked packages,
  model assets, and build provenance;
- Ed25519-signed release and channel documents using the shared contracts in
  `packages/liatir-core/src/runtime-box.ts`;
- exact OS, architecture, accelerator, app-version, and memory compatibility;
- resumable checksummed download into a runtime-specific staging area;
- safe extraction, post-extraction import self-test, atomic activation, and one
  retained rollback runtime;
- R2 for immutable objects and a small Worker control plane for signed channel,
  rollout, and revocation metadata.

The Worker never proxies large runtime archives. Local development uses the
same format through `npm run runtime-box -- build|verify|serve`; production adds
`publish` and authenticated `promote` operations.

The former locally built and direct-download AI runtime strategies were removed
on 2026-07-22. Future model families must not restore them.

## Heavy boxes

Large scientific systems should be added only as dedicated Runtime Boxes:

- separate runtime id;
- separate package set;
- separate model cache and weight validation;
- explicit host compatibility;
- dedicated install progress and logs;
- direct docs page;
- dedicated AI Tool or native tool adapter;
- Results, Jobs, and provenance connected through the common contract.

Do not add a heavy dependency to the frontend bundle, global Node dependencies,
or a shared runtime unless it is truly common and version-compatible.

## Failure isolation

When a box fails:

- unrelated boxes must remain usable;
- unrelated pipeline runs must not be blocked;
- logs should point to the owning box and run id;
- Results should preserve failed run context;
- user-facing errors should describe the actionable input/runtime issue.

This is not only implementation cleanliness. It is a product requirement for a
scientific desktop app where workflows can be long and expensive.
