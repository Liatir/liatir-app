# Liatir 1.0.0 release notes

## Plugins shared across workspaces

A `.lia` Plugin imported once is available in every workspace. Plugins imported
in earlier versions are collected automatically, and saved pipelines keep
working. Runs, Jobs, logs and Results still belong to the workspace where they
started, even if you switch workspace while they run.

Leaving a workspace no longer stops tools, Plugins or Scripts that are running:
they finish and save their Results where they started. Pipelines still stop when
you leave their workspace, so Liatir now asks before switching.

## Python Scripts

**Scripts** in the sidebar holds small Python programs for the current
workspace. Each script declares its inputs and outputs; Liatir checks them on
every run, so a pipeline only passes on values of the declared kind. Scripts run
on their own or as pipeline steps, and every run keeps a copy of the exact code
and packages it used. **Copy to workspace** makes an independent copy for
another project. Earlier JavaScript scripts stay readable and exportable under
**Older JavaScript scripts**; they are not converted.

## Seven new pipeline presets

Docking with a 3D view of the complex, screening with GNINA rescoring, docking
to molecular dynamics and analysis, trajectory motion and interactions,
metabolic fluxes and feasible ranges, biochemical reaction networks, and
multicellular populations. Each card says what it produces, what you choose and
what it requires (platform, components, NVIDIA GPU) before you start. Scientific
settings are left to you; a preset is not a validated study.

## Quenta

- **Two local model profiles.** Standard for 16 GB of memory (Qwen 3.5 9B, a
  6.6 GB download) and Extended for 32 GB (Qwen 3.8 27B, 17.7 GB). Nothing is
  downloaded until you choose a profile; a model you already use is kept, and
  you can switch profile or pick another installed model in Quenta's settings.
- **No unnecessary engine downloads.** When Quenta is set to an Ollama address
  other than the standard one and it does not answer, Liatir now reports it
  instead of downloading and starting its own engine there.
- **Stage.** A chat beside a live Stage: ask for an interactive page about the
  Results you attach or about any topic, watch each step as Quenta works, and ask
  for changes in the next message to get a new version. The page is built from more
  than forty ready-made elements (charts, tables, diagrams, quizzes, sliders, tabs,
  pop-ups and more), and numbers about your Results are read from their saved
  tables, with the source shown under each one. The page runs without internet,
  external resources or access to your files and app commands, is saved as a new
  Result with its sources, and can be downloaded as one HTML file.

### Why the Standard profile uses Qwen 3.5 9B

Gemma 4 12B was compared with Qwen 3.5 9B on a 16 GB Mac, with four
Quenta-style questions (a docking result in Italian, a failed job, a question
whose answer was not in the data, a greeting):

| | Qwen 3.5 9B (Standard) | Gemma 4 12B |
| --- | --- | --- |
| Memory while loaded | about 6.2 GB | about 9.6 GB |
| Writing speed | about 9 tokens/s | about 5 tokens/s |
| Answered in the user's language | yes | yes |
| Said when data was missing | yes | yes |
| Unsupported suggestions | a "Repair" setting Liatir does not have; file formats absent from the log | two analysis tools Liatir does not include |

The answers were of similar quality, so the lighter and faster model stays the
Standard profile and leaves more memory to scientific tools. Bonsai 2 27B, a
compressed version of Qwen 3.8 27B, was also tried: its answers were slightly
more careful, but it wrote about 4 tokens per second (Qwen 3.5 9B about 10, on
the same Ollama version) and it needs a newer Ollama than earlier Liatir
installations have. Four questions are
not a benchmark. The Extended profile was not measured: its model does not fit
in 16 GB of memory.

## Not yet done

An extended run of long scientific workflows was not part of this release
check. Publication is a separate step.
