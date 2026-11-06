# MHC-I Epitope Prediction

MHC-I Epitope Prediction is an AI Tool that ranks short protein fragments by how
likely the immune system is to display them, so you can pick the few worth
testing.

It runs on
[MHCflurry Class I Presentation](/ai/models/openvax-mhcflurry-class1-presentation),
which must be installed from **AI Models**.

## What it does

An **epitope** is the short fragment — usually 8 to 11 amino acids long — that a
cell shows on its surface for immune cells to inspect. Which fragments get shown
depends on the person's HLA type.

The tool takes a protein, cuts it into every fragment of the lengths you choose,
and asks MHCflurry to score each fragment against each HLA variant you named.
The output is one ranked table: the fragments at the top are the candidates.

## Inputs

| Input | Meaning |
| --- | --- |
| AI Model | Installed MHCflurry Class I Presentation |
| Input type | Protein FASTA, or a peptide table you already have |
| Protein FASTA or peptide table | The file from Data (`.fasta`, `.fa`, `.faa`, `.csv`, `.tsv`) |
| HLA Class I alleles | 1 to 12 variants, written as `HLA-A*02:01` |
| Peptide lengths | Fragment lengths to test, from 8 to 15 (8, 9, 10, 11 by default) |
| Prediction mode | Presentation or Binding |
| Top peptides | How many of the best fragments to export, up to 5,000 |

**Presentation or Binding.** Presentation is the default and usually what you
want: it asks how likely the fragment is to end up on the cell surface, taking
into account the cuts around it. Binding asks only how tightly the fragment
sticks to the HLA molecule. Presentation ranks from high to low; binding ranks by
predicted strength, where lower numbers mean tighter binding.

**Allele names must be exact**, in the form `HLA-A*02:01` — gene letter, then
two numbers, then two more. Liatir refuses a malformed name instead of guessing
at it.

**A peptide table** needs a column called `peptide`. It may also have `name`,
`n_flank` and `c_flank` columns, the last two being the amino acids on either
side of the fragment in the original protein, which the presentation model uses.
Every peptide must match one of the lengths you selected.

**There is a size limit.** A run may produce at most 2,000,000 peptide–allele
combinations. A whole proteome against 12 alleles is beyond it; Liatir says so
before running, rather than filling your disk.

## Outputs

| Output | Meaning |
| --- | --- |
| Ranked predictions | CSV with every peptide–allele combination, best first |
| Top peptides | FASTA with the best fragments, ready for a downstream step |
| Prediction summary | JSON with counts, settings, the accelerator used, and warnings |

## Reading the result

Check the alleles, the lengths and the mode first: the same protein gives
completely different rankings for a different HLA type. Then look at whether the
top fragments cluster in one region of the protein, which is usually more
convincing than scattered single hits.

These predictions prioritize experimental candidates. They are not a validated
vaccine, therapy, or diagnostic result.

## In pipelines

The tool is available as a pipeline step, so you can go from a protein sequence
to a ranked candidate list repeatably. In the pipeline editor, the AI Model
dropdown only shows compatible installed models.

Nothing leaves your computer: the run refuses network access outright, even if a
future library version were to attempt it.
