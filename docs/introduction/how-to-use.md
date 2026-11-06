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

In each table, **Tool to open** is what you click in Liatir, and **Powered by**
is the scientific program or AI Model doing the work underneath — useful when you
write up a method, and it is the name you will find in the literature.

### Docking, then a real simulation

**What docking means.** Most drugs work by sticking into a pocket on the surface
of a protein, a bit like a key going into a lock. **Docking** is the computer
doing that by trial: it takes your molecule, tries it in the pocket in thousands
of positions and angles, throws away the ones that do not fit, and gives each
surviving position a score for how well it sits. Each position is called a
**pose**. The answer you get is a short list of poses, best score first.

The catch is that the score is a rough estimate, and it is often wrong about
which pose is best. That is why this workflow does not stop at docking.

| Step | What happens | Tool to open | Powered by |
| --- | --- | --- | --- |
| 1 | The protein is repaired and made ready | [Receptor Preparation](/tools/molecular-docking) | AutoDock Vina |
| 2 | The molecule is tried in the pocket, and the poses ranked | [Molecular Docking](/tools/molecular-docking) | AutoDock Vina |
| 3 | Those poses are re-judged by a neural network | [Neural Pose Rescoring](/tools/neural-pose-rescoring) | GNINA |
| 4 | The pose you chose is packaged with its protein | [Docked Complex](/tools/molecular-docking) | AutoDock Vina |
| 5 | The two move together in water, as a film | [Molecular Dynamics](/tools/molecular-simulation) | OpenMM |
| 6 | You measure whether the contacts held | [Trajectory Analysis, Interaction Fingerprint](/tools/molecular-analysis) | MDAnalysis, ProLIF |

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

| Step | What happens | Tool to open | Powered by |
| --- | --- | --- | --- |
| 1 | Reads become a table of genes per cell | [Single-cell Quantification](/tools/single-cell-quant) | simpleaf, included with Liatir |
| 2 | Each cell is summarised as a list of numbers | [Single-cell Embedding](/ai/tools/single-cell-embedding) | scGPT, Geneformer or UCE — your choice |
| 3 | You see which cells group together | [Single-cell Viewer](/visualization/single-cell-viewer) | Built into Liatir |

There is a ready-made pipeline for steps 2 and 3: open **Pipelines** and choose
**Single-cell embedding and preview**. If you already have a dataset file, start
at step 2.

### From a sequence to a candidate molecule

For a protein whose shape nobody has measured yet.

| Step | What happens | Tool to open | Powered by |
| --- | --- | --- | --- |
| 1 | The protein's shape is predicted | [Structure Prediction](/ai/tools/structure-prediction) | Boltz-2 |
| 2 | An independent model is asked the same thing | [Structure Prediction](/ai/tools/structure-prediction) | Protenix |
| 3 | You look at the shape and its confidence scores | [3D Structure Viewer](/visualization/structure-viewer) | Built into Liatir |
| 4 | Your candidate molecules are ranked | [Protein–Ligand Affinity](/ai/tools/protein-ligand-affinity) | Boltz-2 |
| 5 | The best candidates are tested properly | The docking workflow above | AutoDock Vina, GNINA, OpenMM |

Step 2 is the cheap insurance: when two models built by different teams agree,
the shape is far more likely to be right.

### From a tumour's mutations to immune targets

| Step | What happens | Tool to open | Powered by |
| --- | --- | --- | --- |
| 1 | The tumour's variants are inspected and filtered | [BCFtools](/tools/bcftools) | Included with Liatir |
| 2 | Each mutation is annotated with its effect on the protein | Not a Liatir tool — see below | VEP, from Ensembl |
| 3 | The mutations the immune system could see are ranked | [Neoantigen Prioritization](/tools/neoantigen-prioritization) | pVACtools, with MHCflurry |

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
