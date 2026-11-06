# What to use, and in what order

Liatir has a lot of pieces. This page is the map: one line each on what they are
for, and the usual ways they are chained together. Every name links to its own
page when you want the detail.

## The AI Models, in one line each

| AI Model | What it tells you | You start from |
| --- | --- | --- |
| [scGPT](/ai/models/bowang-scgpt-whole-human), [Geneformer](/ai/models/ctheodoris-geneformer-v1-10m) | which of your cells resemble each other (human) | a single-cell dataset |
| [UCE 4-layer](/ai/models/snap-stanford-uce-4layer) | the same, for many species | a single-cell dataset |
| [Boltz-2](/ai/models/jwohlwend-boltz-2) | the 3D shape of a protein, and whether a molecule binds it | sequences, written out |
| [Protenix](/ai/models/bytedance-protenix-base-v1-0-0) | a second opinion on that shape, from an independent model | sequences, written out |
| [MHCflurry](/ai/models/openvax-mhcflurry-class1-presentation) | which fragments of a protein the immune system would display | a protein sequence |

The first three do the same job: they turn each cell into a list of numbers, so
that cells behaving alike end up with similar numbers. That is what lets you
group them. The last three answer questions about single proteins.

## The tools, grouped by what you do with them

| If you want to… | Use |
| --- | --- |
| check and clean sequencing files | [FastQC](/tools/fastqc), [fastp](/tools/fastp), [seqkit](/tools/seqkit) |
| line reads up against a genome | [BWA-MEM](/tools/bwa-mem), [Minimap2](/tools/minimap2), [Samtools](/tools/samtools) |
| work with genetic variants | [BCFtools](/tools/bcftools), [SnpEff](/tools/snpeff) |
| count genes cell by cell | [Single-cell Quantification](/tools/single-cell-quant) |
| fit a molecule into a protein | [Molecular Docking](/tools/molecular-docking), [Neural Pose Rescoring](/tools/neural-pose-rescoring) |
| watch molecules move | [Molecular Simulation](/tools/molecular-simulation) |
| measure what happened in a simulation | [Trajectory and Interaction Analysis](/tools/molecular-analysis) |
| model a cell's chemistry or a tissue | [Metabolic Modeling](/tools/metabolic-modeling), [Biochemical Simulation](/tools/biochemical-simulation), [Multicellular Simulation](/tools/multicellular-simulation) |
| find immune targets in a tumour | [Neoantigen Prioritization](/tools/neoantigen-prioritization) |
| look at a result | [the viewers](/visualization/overview) |

## Four workflows

### Docking, then a real simulation

The fullest chain in Liatir, and the one it was tested on end to end. You want to
know whether a drug molecule really sits in a protein the way docking suggests.

| Step | Use | What comes out |
| --- | --- | --- |
| 1 | [Receptor Preparation](/tools/molecular-docking) | the protein, repaired and ready |
| 2 | [Molecular Docking](/tools/molecular-docking) | candidate positions of the molecule, ranked |
| 3 | [Neural Pose Rescoring](/tools/neural-pose-rescoring) | the same positions, re-judged by a neural network |
| 4 | [Docked Complex](/tools/molecular-docking) | the chosen position, packaged with its protein |
| 5 | [Molecular Dynamics](/tools/molecular-simulation) | a film of the two moving together in water |
| 6 | [Trajectory and Interaction Analysis](/tools/molecular-analysis) | whether the contacts held, and how much things moved |

**Why the last two steps matter.** Docking gives you a still picture and a score.
A simulation lets the molecule actually move: a position that falls apart in the
first nanosecond was never real. Steps 3 and 6 exist because the ranking from
step 2 is often wrong — in Liatir's own test, docking put two badly wrong
positions above a correct one, and the neural network fixed the order.

**A worked example.** Liatir ran exactly this chain on imatinib, a leukaemia drug,
and its target protein: the predicted position landed 0.37 Å from the one
measured by crystallography, and through the whole simulation the key contact
seen in the laboratory never broke.

### From raw sequencing to groups of cells

| Step | Use |
| --- | --- |
| 1 | [Single-cell Quantification](/tools/single-cell-quant) — turn reads into a table of genes per cell |
| 2 | [Single-cell Embedding](/ai/tools/single-cell-embedding) — have an AI Model summarise each cell |
| 3 | [Single-cell Viewer](/visualization/single-cell-viewer) — see which cells group together |

There is a ready-made pipeline for steps 2 and 3: open **Pipelines** and choose
**Single-cell embedding and preview**. If you already have a dataset file, start
at step 2.

### From a sequence to a candidate molecule

For a protein whose structure nobody has measured.

| Step | Use |
| --- | --- |
| 1 | [Structure Prediction](/ai/tools/structure-prediction) with Boltz-2 — get its shape |
| 2 | the same, with Protenix — check that an independent model agrees |
| 3 | [3D Structure Viewer](/visualization/structure-viewer) — look at it, and at the confidence scores |
| 4 | [Protein–Ligand Affinity](/ai/tools/protein-ligand-affinity) — rank your candidate molecules |
| 5 | the docking workflow above — test the best ones properly |

Step 2 is the cheap insurance: when two models built by different teams agree,
the shape is far more likely to be right.

### From a tumour's mutations to immune targets

| Step | Use |
| --- | --- |
| 1 | [BCFtools](/tools/bcftools) — inspect and filter the tumour's variants |
| 2 | annotate them with **VEP**, outside Liatir |
| 3 | [Neoantigen Prioritization](/tools/neoantigen-prioritization) — rank the mutations the immune system could see |

**Step 2 is not a Liatir tool.** Neoantigen Prioritization needs a variant file
annotated by VEP, Ensembl's annotator, and Liatir does not ship it: run it
yourself, or as a [Nextflow workflow](/tools/external-workflows) from inside
Liatir. [SnpEff](/tools/snpeff) is Liatir's own annotator and is excellent for
reading variants, but it writes a different format and this tool will not accept
it.

If you already have a protein sequence rather than a variant file, skip all of
this and use [MHC-I Epitope Prediction](/ai/tools/mhc-epitope-prediction), which
does the prediction step on its own.

## What your computer can run

The everyday tools — quality checks, alignment, variants, single-cell counting —
run everywhere. The heavy science is more selective.

| | Mac | Linux | Windows |
| --- | --- | --- | --- |
| everyday tools | yes | yes | yes, through WSL2 |
| single-cell AI Models | yes | yes | yes, through WSL2 |
| immune prediction (MHCflurry, pVACseq) | yes | yes | yes, through WSL2 |
| docking, metabolism, cell and tissue simulation | no | yes | yes, through WSL2 |
| structure prediction, molecular dynamics, pose rescoring | no | yes, NVIDIA GPU | yes, NVIDIA GPU through WSL2 |

The single-cell row is the one with exceptions: UCE runs on Mac only, and
Geneformer on Linux needs an NVIDIA GPU. [AI Models](/ai/models/overview) lists
exactly where each one runs.

**WSL2** is a Linux environment built into Windows; Liatir sets it up and you
keep working in the normal Liatir window. See
[Tools](/tools/overview#windows-and-wsl2).

Liatir never lets you install something your computer cannot run: it checks
first and says what is missing.

## Two things that are true of everything here

**It all runs on your machine.** Nothing is uploaded, and after installation
everything works offline.

**Every result is a hypothesis, not a measurement.** Predicted shapes, predicted
binding, predicted immune targets, grouped cells: they tell you what to test
next. Each result says so, and each page explains what was and was not checked.
