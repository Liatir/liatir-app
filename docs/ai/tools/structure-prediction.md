# Structure Prediction

Structure Prediction is an AI Tool that works out the three-dimensional shape of
proteins and molecular complexes from their sequences.

It runs on [Boltz-2](/ai/models/jwohlwend-boltz-2) or
[Protenix base v1.0.0](/ai/models/bytedance-protenix-base-v1-0-0), installed from
**AI Models**. You find it in the app under **Tools → Structure Prediction**, and
it is available as a step in a [pipeline](/pipeline/overview).

## What it does

A protein is made as a long chain of amino acids, and then folds into a specific
shape. The shape is what determines what the protein does and what can bind to
it, but measuring it in a laboratory takes months. These models predict the
shape — the position of every atom — from the sequence alone, in minutes.

You can predict a single protein, or several molecules together to see how they
fit: two proteins, a protein with DNA or RNA, or a protein with a small
molecule.

## Inputs

You describe the molecules you want to study together:

| For each molecule | What you give |
| --- | --- |
| Protein, DNA or RNA | Its sequence, an identifier, and how many copies are in the complex |
| Small molecule | A SMILES string (a text description of its atoms and bonds), or a chemical dictionary code |

Plus two settings: a **seed**, a number that lets you repeat exactly the same
prediction, and the **number of predicted structures** to draw.

### Alignments, and why they matter here

Normally these models work better when they are also given a **multiple sequence
alignment**: a comparison of your protein with similar proteins from other
species, which reveals which parts matter. Building one usually means sending
your sequence to a server to search a database.

Liatir works offline and never does that. So you have two choices for each
protein:

- **Single-sequence mode**: predict from the sequence alone. You have to tick a
  box acknowledging that this is less accurate — markedly so for some proteins.
- **Provide your own alignment**: if you have an A3M alignment file, add it in
  Data and select it here. Only Boltz-2 can use one; Protenix in Liatir always
  predicts from the sequence alone.

You may also add a known structure as a **template** to guide the prediction.

### Before it runs

Liatir estimates how much memory, GPU memory and time the prediction needs, and
compares that with the largest prediction the model was actually measured on. If
yours is bigger, it tells you that you are past measured ground and asks you to
confirm. If another prediction is already using the GPU, this one waits for it
instead of competing.

## Outputs

| Output | Meaning |
| --- | --- |
| Predicted structure | mmCIF file, which opens in the [3D Structure Viewer](/visualization/structure-viewer) |
| Confidence | pLDDT and pTM scores, per part of the structure and overall |

**pLDDT** says how confident the model is about each region: high values mean the
local shape is probably right, low values often mean a floppy region with no
fixed shape. **pTM** says how confident it is about the overall arrangement,
which matters most when you predicted several molecules together.

## Reading the result

Look at confidence before shape. A low-confidence region is a guess, and
alignment-free predictions carry an explicit warning saying so in every result.

A useful habit is to predict the same complex with both models: they were built
by different teams from different code, so when Boltz-2 and Protenix agree the
structure is more trustworthy. On the test case Liatir measured, Protenix was
slightly less accurate and about four times slower, which is why its value is as
a second opinion.

A predicted structure is a hypothesis to test, not a measurement.
