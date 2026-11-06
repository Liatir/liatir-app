# How to use it

Liatir has a lot of pieces. This page is the map: one line each on what they are
for, and the usual ways they are chained together. Every name links to its own
page when you want the detail.

## The AI Models, in one line each

| AI Model | What it tells you | You start from |
| --- | --- | --- |
| [scGPT](/ai/models/bowang-scgpt-whole-human), [Geneformer](/ai/models/ctheodoris-geneformer-v1-10m) | Which of your cells resemble each other (human only) | A single-cell dataset |
| [UCE 4-layer](/ai/models/snap-stanford-uce-4layer) | The same, for many species | A single-cell dataset |
| [Boltz-2](/ai/models/jwohlwend-boltz-2) | The 3D shape of a protein, and whether a molecule binds it | Sequences, written out |
| [Protenix](/ai/models/bytedance-protenix-base-v1-0-0) | A second opinion on that shape, from an independent model | Sequences, written out |
| [MHCflurry](/ai/models/openvax-mhcflurry-class1-presentation) | Which fragments of a protein the immune system would display | A protein sequence |

The first three do the same job: they turn each cell into a list of numbers, so
that cells behaving alike end up with similar numbers. That is what lets you
group them. The last three answer questions about single proteins.

## The tools, grouped by what you do with them

| What you want to do | Use |
| --- | --- |
| Check and clean sequencing files | [FastQC](/tools/fastqc), [fastp](/tools/fastp), [seqkit](/tools/seqkit) |
| Line reads up against a genome | [BWA-MEM](/tools/bwa-mem), [Minimap2](/tools/minimap2), [Samtools](/tools/samtools) |
| Work with genetic variants | [BCFtools](/tools/bcftools), [SnpEff](/tools/snpeff) |
| Count genes cell by cell | [Single-cell Quantification](/tools/single-cell-quant) |
| Fit a molecule into a protein | [Molecular Docking](/tools/molecular-docking), [Neural Pose Rescoring](/tools/neural-pose-rescoring) |
| Watch molecules move | [Molecular Simulation](/tools/molecular-simulation) |
| Measure what happened in a simulation | [Trajectory and Interaction Analysis](/tools/molecular-analysis) |
| Model a cell's chemistry, or a tissue | [Metabolic Modeling](/tools/metabolic-modeling), [Biochemical Simulation](/tools/biochemical-simulation), [Multicellular Simulation](/tools/multicellular-simulation) |
| Find immune targets in a tumour | [Neoantigen Prioritization](/tools/neoantigen-prioritization) |
| Look at a result | [The viewers](/visualization/overview) |

## Four workflows

### Docking, then a real simulation

**What docking means.** Most drugs work by sticking into a pocket on the surface
of a protein, a bit like a key going into a lock. **Docking** is the computer
doing that by trial: it takes your molecule, tries it in the pocket in thousands
of positions and angles, throws away the ones that do not fit, and gives each
surviving position a score for how well it sits. Each position is called a
**pose**. The answer you get is a short list of poses, best score first.

The catch is that the score is a rough estimate, and it is often wrong about
which pose is best. That is why this workflow does not stop at docking.

| Step | Use | What comes out |
| --- | --- | --- |
| 1 | [Receptor Preparation](/tools/molecular-docking) | The protein, repaired and ready |
| 2 | [Molecular Docking](/tools/molecular-docking) | Candidate poses, ranked by score |
| 3 | [Neural Pose Rescoring](/tools/neural-pose-rescoring) | The same poses, re-judged by a neural network |
| 4 | [Docked Complex](/tools/molecular-docking) | The chosen pose, packaged with its protein |
| 5 | [Molecular Dynamics](/tools/molecular-simulation) | A film of the two moving together in water |
| 6 | [Trajectory and Interaction Analysis](/tools/molecular-analysis) | Whether the contacts held, and how much things moved |

**Why the last two steps matter.** Docking gives you a still picture. A
simulation lets the molecule actually move, surrounded by water, the way it would
in a cell: a pose that falls apart in the first instant was never real. Step 3
exists for the same reason — in Liatir's own test, docking ranked two badly
wrong poses above a correct one, and the neural network put them back in order.

**A worked example.** Liatir ran exactly this chain on imatinib, a leukaemia
drug, and its target protein. The predicted pose landed 0.37 Å from the one
measured by crystallography — about a hundredth of the width of the molecule —
and through the whole simulation the key contact seen in the laboratory never
broke.

### From raw sequencing to groups of cells

| Step | Use |
| --- | --- |
| 1 | [Single-cell Quantification](/tools/single-cell-quant) — Turn reads into a table of genes per cell |
| 2 | [Single-cell Embedding](/ai/tools/single-cell-embedding) — Have an AI Model summarise each cell |
| 3 | [Single-cell Viewer](/visualization/single-cell-viewer) — See which cells group together |

There is a ready-made pipeline for steps 2 and 3: open **Pipelines** and choose
**Single-cell embedding and preview**. If you already have a dataset file, start
at step 2.

### From a sequence to a candidate molecule

For a protein whose shape nobody has measured yet.

| Step | Use |
| --- | --- |
| 1 | [Structure Prediction](/ai/tools/structure-prediction) with Boltz-2 — Get its shape |
| 2 | The same, with Protenix — Check that an independent model agrees |
| 3 | [3D Structure Viewer](/visualization/structure-viewer) — Look at it, and at the confidence scores |
| 4 | [Protein–Ligand Affinity](/ai/tools/protein-ligand-affinity) — Rank your candidate molecules |
| 5 | The docking workflow above — Test the best ones properly |

Step 2 is the cheap insurance: when two models built by different teams agree,
the shape is far more likely to be right.

### From a tumour's mutations to immune targets

| Step | Use |
| --- | --- |
| 1 | [BCFtools](/tools/bcftools) — Inspect and filter the tumour's variants |
| 2 | Annotate them with **VEP**, outside Liatir |
| 3 | [Neoantigen Prioritization](/tools/neoantigen-prioritization) — Rank the mutations the immune system could see |

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
| Everyday tools | Yes | Yes | Yes, through WSL2 |
| Single-cell AI Models | Yes | Yes | Yes, through WSL2 |
| Immune prediction (MHCflurry, pVACseq) | Yes | Yes | Yes, through WSL2 |
| Docking, metabolism, cell and tissue simulation | No | Yes | Yes, through WSL2 |
| Structure prediction, molecular dynamics, pose rescoring | No | Yes, with an NVIDIA GPU | Yes, with an NVIDIA GPU, through WSL2 |

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
