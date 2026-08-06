# Quenta

Quenta is a local, read-only AI inside Liatir. It helps explain app
state, bioinformatics workflows, Results, Jobs, pipeline structure, and failure
logs using local context.

It is designed for guidance and reports, not automation.

## What it can do

- Explain a Result and what its recorded output means.
- Explain a failed or cancelled run using logs and metadata.
- Generate a cited Markdown-style scientific report from a Result.
- Answer questions about Liatir concepts, pipelines, AI Models, AI Tools,
  API Connector requests, and common bioinformatics interpretation issues.
- Cite the local sources it used, such as a Result, Job, pipeline, or built-in
  bioinformatics note.

## What it cannot do

Quenta cannot:

- run pipelines;
- run tools;
- run Plugins;
- run AI Models or AI Tools;
- send API Connector requests;
- edit files;
- change workspace state;
- execute shell commands.

The model receives text context only. Liatir does not send tool callbacks to the
model.

## Requirements

The first Quenta runtime uses Ollama running locally.

1. Install and start Ollama.
2. Pull a local chat model in Ollama.
3. Open **Quenta** in Liatir.
4. Set the Ollama base URL, usually `http://127.0.0.1:11434`.
5. Refresh models and select the model you want to use.
6. Save settings.

Liatir accepts only local loopback Ollama endpoints for this feature.

## Explaining a Result

Open **Results**, select a run, then choose:

- **Explain with Quenta** for a guided interpretation.
- **Quenta report** for a structured report.
- **Explain with Quenta** for a failed or cancelled run.

Quenta will open with that Result as its focus. Focused Results are forced
into the retrieval context so the model sees the selected run metadata,
structured output, output files, and recent logs.

## Explaining a Job

Open **Jobs** and choose **Explain with Quenta**. Quenta uses
the job status, command metadata, parent pipeline metadata when available, and
buffered stdout/stderr.

## How to read Quenta answers

Treat Quenta answers as scientific guidance. Check the cited sources and the
original Result or Job before acting on conclusions.

Good Quenta answers should:

- cite local sources;
- distinguish observed evidence from interpretation;
- state limitations;
- recommend validation steps;
- avoid inventing missing metrics;
- avoid clinical or diagnostic conclusions.

If a source is missing, Quenta should say what is missing instead of filling
the gap.
