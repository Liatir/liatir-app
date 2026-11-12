# Quenta

Quenta is a local, read-only AI inside Liatir. It helps explain app
state, bioinformatics workflows, Results, Jobs, pipeline structure, and failure
logs using local context.

Chat provides guidance. A separate Presentations mode builds an offline HTML page from Results you select. It does not run scientific analyses.

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
- edit source data or arbitrary files;
- change scientific configuration;
- execute shell commands.

The model receives text context only. Liatir does not send tool callbacks to the
model.

## Requirements

Quenta runs its language model on your computer through Ollama, a local
program that runs such models. The first time you open Quenta, choose the
profile that matches your computer's memory:

- **Standard, for 16 GB of memory:** Qwen 3.5 9B, a 6.6 GB download. On a
  16 GB Mac it uses about 6.2 GB of memory while loaded.
- **Extended, for 32 GB of memory:** Qwen 3.8 27B, a 17.7 GB download.

Choosing a profile downloads its model once; opening Quenta never starts a
download. You can change profile at any time in Quenta's settings. If you
already use another model, Quenta keeps it, and the **Model** list in the
settings lets you choose any other model already installed in Ollama. Both profiles read up to 16,384 tokens
(pieces of words) per request, the amount Quenta has always used. On macOS
Liatir can prepare Ollama itself; on other systems install and start Ollama
first. Everything works offline after the download.

Other analyses running at the same time also need memory, and answers are
slower on smaller computers: on a 16 GB Mac the Standard model writes about 9
tokens per second.

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

## Interactive presentations

Quenta has two modes, switched at the top right of its pages: **Chat** and
**Presentations**. Open **Presentations**, or choose **Create presentation** on a
Result.
Tick one or more completed Results and describe how the page should show them,
or tick none and describe any topic, for example *how molecular docking works,
explained simply with a diagram*. Quenta creates an interactive HTML page using
Preact, a small page-building library that ships inside Liatir. A page about
Results receives a saved copy of their structured outputs. A page about a topic
is written from the model's general knowledge: it says so, and any numbers or
charts on it are marked as illustrative examples, not measurements. Either way the
page cannot reach the internet, external resources, your files or Liatir commands.

Liatir checks that the page renders and allows one correction attempt on failure.
A successful presentation is saved as its own Result with a standalone offline
HTML file and the source snapshots/code. Reopen it from Results or export its
HTML file. Original scientific Results are unchanged. Generation can be cancelled;
failed or cancelled attempts retain their diagnostic Result.

The presentation's interpretation is AI-generated. Check its figures, units and
conclusions against the cited source Results. The ordinary chat mode remains
read-only; this dedicated mode saves only the presentation requested by you.
