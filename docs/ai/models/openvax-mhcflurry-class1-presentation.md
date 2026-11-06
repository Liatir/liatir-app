# MHCflurry Class I Presentation

MHCflurry predicts which short pieces of a protein the immune system is likely
to put on display, using [MHCflurry](https://github.com/openvax/mhcflurry)
2.2.1. Liatir runs it entirely on your computer.

## What it does

Your cells constantly cut proteins into short fragments, called **peptides**,
and present some of them on their surface with a molecule called **MHC Class I**
(in humans, **HLA**). Immune cells inspect what is on display: a peptide that
comes from a tumour or a virus can be the signal that starts an immune response.

Which peptides get displayed depends on the person's HLA type, and there are
thousands of HLA variants. MHCflurry predicts, for a given HLA variant:

- how strongly a peptide **binds** that HLA molecule;
- how likely the peptide is to be **presented** at all, which also accounts for
  the cuts the cell makes on either side of the peptide.

This is how a long list of possible peptides gets narrowed down to a short list
worth testing in the laboratory.

## Current status in Liatir

MHCflurry 2.2.1 is published as a signed Runtime Box for **Apple silicon Macs**
(Metal) and for **Linux x86_64** on the processor. Windows computers run the same
Linux box through WSL2. A GPU is not required: this model is small and runs on
the processor.

Before publication, the exact box you download was checked against known
immunology: all the test HLA variants were supported, known control peptides
ranked at the top for HLA-A\*02:01 and HLA-A\*11:01, and a mutated KRAS peptide
(GADGVGKSA) ranked far above its normal counterpart (GAGGVGKSA) for
HLA-C\*08:02 — 0.18 against 4.5 percentile, where lower means more likely to be
presented.

## What to keep in mind

- **These are predictions, not results.** They prioritize candidates to test.
  They are not a validated vaccine, therapy, or diagnostic result, and Liatir
  shows this notice with every run.
- **Class I only.** MHCflurry here covers MHC Class I, the pathway that shows
  peptides to killer T cells. Class II is not included.
- **The HLA variant must be one the model knows.** If you enter a variant
  MHCflurry was not trained on, the run stops and names it, rather than guessing.

## Expected inputs

Either a protein sequence file (FASTA), from which Liatir cuts every possible
peptide of the lengths you choose, or a table of peptides you already have. Plus
the HLA Class I variants you care about.

## Expected outputs

A ranked table of every peptide–HLA combination, the best peptides as a FASTA
file, a summary, and Runtime Box provenance, like every Liatir run.

## Hardware and installation

At least 8 GB of memory, 16 GB recommended. Install it from **AI Models**;
everything MHCflurry needs lives inside the Runtime Box and is never added to
your system. After installation it works offline.

## How to run it

Through the [MHC-I Epitope Prediction](/ai/tools/mhc-epitope-prediction) AI
Tool, from this model's page in the app or as a step in a
[pipeline](/pipeline/overview).

If you are starting from a tumour's variant file rather than a protein sequence,
[Neoantigen Prioritization](/tools/neoantigen-prioritization) does the whole
chain for you and uses MHCflurry internally.

## Official source

- [MHCflurry on GitHub](https://github.com/openvax/mhcflurry), Apache License
  2.0, for both the code and the model weights.
