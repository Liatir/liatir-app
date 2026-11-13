# Quenta

Quenta is a local, read-only AI inside Liatir. It helps explain app
state, bioinformatics workflows, Results, Jobs, pipeline structure, and failure
logs using local context.

Chat provides guidance. A separate Stage mode builds an interactive offline page, about Results you select or about any topic. It does not run scientific analyses.

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

You can also attach one from inside a chat. By default you just talk to
Quenta; choose **Attach a Result or failure** above the message box to pick a
completed Result (Quenta explains it) or a failed or cancelled one (Quenta
explains what went wrong). With something attached you can send without typing
to get the explanation, or ask your own question about it. Remove it with the X
on its label to go back to a plain chat.

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

## Stage

Quenta has two modes, switched at the top right of its pages: **Chat** and
**Stage**. Stage is also a chat: on the left you ask, on the right the **Stage**
shows the page Quenta builds. Open **Stage**, or choose **Open in Stage** on a Result
to start a conversation with that Result attached.

Write what you want in your own words, for example *explain how molecular docking
works, simply, with a diagram*. Use **Add Results** to build the page on real data,
or attach nothing for a page about any topic. While Quenta works, the chat shows
each step: preparing the data, writing the page, checking it, and saving. The
finished page appears on the Stage: one page that scrolls, with a header, a short
index of its sections and a closing summary. Ask for changes in the next message,
such as *make the chart larger*: Quenta revises the current version into a new one,
and **Show on stage** brings back any earlier version. **Download HTML** saves the
page on the Stage as one file that opens offline in any browser.

Quenta does not write the page as program code. It fills in a description of it,
section by section, choosing from more than forty ready-made elements that ship
inside Liatir: text, lists, steps and timelines; charts (bars, lines, scatter, pies,
histograms, box plots, heatmaps, funnels) and sortable tables; diagrams such as
flows, cycles and overlapping circles; interactive pieces such as a threshold
slider, quizzes, tabs, pop-ups, flip cards and step-by-step walkthroughs; and
decoration such as banners, icons, drawings and backgrounds. Each section is a grid
of up to four columns. Liatir draws the description, so every page has the same look
and a small local model cannot produce a page that fails to open.

A page about Results shows their numbers by reading them from the saved tables of
those Results, never from the model's memory, and says under each chart or number
which Result and table it comes from. A number the model types itself is marked
**AI-entered**. A page about a topic is written from the model's general knowledge:
any numbers or charts on it are marked **Illustrative**, not measurements. Either way
the page cannot reach the internet, external resources, your files or Liatir
commands.

Liatir checks each version before showing it: that every element is complete, that
every table and column it names exists, and that the page displays. If something is
wrong, Quenta gets one chance to correct exactly the points found. Every version is
saved as its own Result with a standalone offline HTML file and its sources and
content; the conversations are kept per workspace. Original scientific Results are
unchanged. **Stop** cancels a version in progress.

The page's interpretation is AI-generated. Check its figures, units and conclusions
against the cited source Results. The ordinary chat mode remains read-only; Stage
saves only the page requested by you.
