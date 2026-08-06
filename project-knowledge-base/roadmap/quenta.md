# Quenta MVP

Quenta is the read-only local AI explanation and report engine for Liatir. It is part
of the Beta 1 plan, but it is not an execution surface.

## Product boundary

Quenta may:

- explain Liatir concepts, pipeline structure, Jobs, Results, provenance, and
  bioinformatics context;
- troubleshoot failures using recorded metadata, logs, and outputs;
- generate cited scientific reports from local evidence;
- answer questions about the active workspace and saved app state.

Quenta must not:

- execute pipelines, tools, Plugins, AI Models, API Connector requests, shell
  commands, or file operations;
- mutate workspace state;
- receive model tool/function callbacks;
- follow instructions embedded in retrieved results, logs, files, or external
  responses.

## State ownership

| Entity | Owner | Persistence |
| --- | --- | --- |
| Provider settings | App-level Quenta settings | `quenta/settings.json` |
| Conversations | Active workspace | `workspaces/<id>/quenta/conversations.json` |
| Model response in progress | Conversation ID | In-memory `sendingByConversation` map |
| Retrieved context | Per request | Rebuilt from current workspace stores |
| Result focus | Conversation focus | `LiatirQuentaFocus { kind: "result", entityId }` |
| Job focus | Conversation focus | `LiatirQuentaFocus { kind: "job", entityId }` |

Do not replace conversation-scoped sending/error maps with one global
`running` flag. Multiple conversations can exist and should remain inspectable
independently.

## Runtime design

- Shared contracts live in `packages/liatir-core/src/quenta.ts`.
- The first runtime provider is Ollama.
- The Tauri bridge accepts only local `http://` loopback endpoints.
- The bridge calls the native Ollama API directly:
  - `GET /api/version`
  - `GET /api/tags`
  - `POST /api/chat`
  - `POST /api/embed`
- Chat requests set `stream: false`.
- Report requests may pass an Ollama `format` JSON schema.
- No `tools` field is sent, and a response containing tool calls is rejected.

## Retrieval design

The MVP uses deterministic local retrieval over:

- built-in Liatir architecture and bioinformatics guidance;
- active workspace metadata;
- current and saved pipelines;
- recent Results with structured output and logs;
- recent Jobs with metadata and buffered stdout/stderr;
- API Connector collections/requests and last responses;
- installed AI Model records.

Focused Result/Job IDs are forced into the retrieved context so deep links from
Results and Jobs cannot miss the selected entity.

Embedding retrieval can be added later using the existing Ollama embed bridge,
but the MVP must work without requiring a separate embedding model.

## Verification status

Current automated gates:

- Unit tests cover retrieval, required focused sources, citation extraction,
  structured report parsing, markdown rendering, and ToolOutput summarization.
- Rust tests cover loopback-only Ollama endpoint validation.
- Tauri E2E uses a mock Ollama server to validate the UI path, provider
  settings, deep-linked Result explanations, structured reports, local context
  injection, source rendering, and the absence of tool callbacks.

This is not enough for `Verified` readiness. Before promoting Quenta to
Verified, add a real local Ollama evaluation matrix with at least one
documented recommended model, small deterministic fixtures, latency/error
expectations, and report-quality review criteria.

## Release hardening checklist

- Choose and document recommended local chat/report models after checking
  license, hardware, context length, and install size.
- Add an optional embedding model recommendation only if it improves retrieval
  quality enough to justify the dependency.
- Add golden evaluation prompts for:
  - successful native tool Result;
  - failed pipeline Result;
  - failed Job;
  - AI Tool Result;
  - API Connector Result;
  - mixed pipeline with upstream/downstream provenance.
- Ensure reports never invent missing metrics or clinical conclusions.
- Keep Quenta read-only even after MCP lands.
