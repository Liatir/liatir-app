# Multicellular Simulation

Simulate how a population of cells grows, divides, moves, dies and changes the
chemistry around it, cell by cell, using [PhysiCell](http://physicell.org)
1.14.2. Liatir runs it entirely on your computer.

Each cell follows the rules of its type: how long its cycle lasts, when it dies,
what it secretes or consumes. Substances such as oxygen spread through the
tissue as the cells use them. The result is a picture of the tissue over time.

You find it under **Tools → Systems Biology**, and it is available as a step in
a [pipeline](/pipeline/overview).

## What you need

Multicellular Simulation runs on a **Tool Runtime** that Liatir installs once,
on request, from **Dependencies → Tool Runtimes**.

| Your computer | Can it run this tool? |
| --- | --- |
| Linux x86_64 | Yes |
| Windows 11, through WSL2 | Yes |
| Mac | No |

- **No graphics card is needed.**
- **Memory and disk.** At least 4 GB of memory. The download is about
  109 MB and needs about 300 MB once installed.

After installation everything works offline.

## Using it

- **Input:** PhysiCell's own template model, or your own settings file
  (`PhysiCell_settings.xml`, for example one saved from PhysiCell Studio), with
  the cell positions and cell rules files it names, if it uses them.
- **Options:** how long to simulate, in minutes; the random seed; and how many
  processor threads to use. With one thread, the same seed repeats a run
  exactly; with more, runs are faster but no longer repeat exactly.
- **Output:** the number of live and dead cells of each type over time, every
  cell at the end with its position and state, the average of each substance
  over time, a picture of the tissue at the end, and plots.

Liatir writes the settings PhysiCell runs itself: it sets the output folder,
threads and seed, and never lets a path in a settings file reach a command.
Settings that need parts this tool does not include — intracellular models,
substance values loaded from `.mat` files — are refused with the reason, as is
a model that starts with no cells.

## How it was checked

Before publication, the exact package you download was tested against what each
model's own parameters predict:

- Cells set to divide exactly every 600 minutes double exactly on schedule, at
  every one of 41 times checked.
- Cells that divide or die at random grow or survive within the statistical
  bounds their rates predict.
- A substance that decays at a known rate follows the exact curve within
  0.00025 %.
- The same seed on one thread repeats the run exactly; another seed differs.
- A settings file with commands hidden in its paths ran, and no command did.

The same package then ran inside the real Liatir app, from installation to
results and removal, on Linux and on Windows through WSL2.

## What the results mean

An agent-based simulation follows the model's cell definitions, rules and
parameters, not the tissue they stand for. Cell behaviour is stochastic, so one
seed gives one sample; with more than one thread the same seed does not repeat a
run exactly. Liatir shows this notice with every result.

## Licences and official source

- [PhysiCell 1.14.2](https://github.com/MathCancer/PhysiCell), with BioFVM:
  BSD-3-Clause; pugixml: MIT. Liatir compiles PhysiCell's template project from
  the official release, reproducibly, and ships the licences and PhysiCell's
  citation with it.
