# Neoantigen Prioritization

Find which mutations in a tumour could be visible to the immune system, using
[pVACtools](https://pvactools.readthedocs.io/en/7.1.2/pvacseq/run.html) 7.1.2
(pVACseq). Liatir runs it entirely on your computer.

You find it under **Tools → Oncology**, and it is available as a step in a
[pipeline](/pipeline/overview).

## What it does

A tumour carries mutations its healthy cells do not. When a mutated protein is
cut up and displayed on the cell surface, the fragment looks foreign to the
immune system: that fragment is a **neoantigen**, and it is what personalised
cancer vaccines and T-cell therapies aim at.

Starting from a list of the tumour's mutations, this tool does the whole chain:

1. works out the mutated protein sequence each mutation produces;
2. cuts out every fragment of the lengths you choose, mutated and normal;
3. predicts which fragments the patient's HLA type would display, using
   [MHCflurry](/ai/models/openvax-mhcflurry-class1-presentation);
4. compares each mutated fragment with its normal counterpart, and ranks the
   candidates.

Step 4 is the point. A fragment is only interesting if the mutated version is
displayed clearly better than the normal one — otherwise the immune system has
already learned to ignore it.

## What you need

| Your computer | Can it run this tool? |
| --- | --- |
| Mac with Apple silicon | Yes |
| Linux x86_64 | Yes |
| Windows 11, through WSL2 | Yes |

- **No graphics card is needed.**
- **Memory.** At least 8 GB, 16 GB recommended for large variant files.
- Install it once from **Dependencies → Tool Runtimes**. Everything it needs
  lives inside the signed package, and after installation it works offline.

## Inputs

| Input | Meaning |
| --- | --- |
| VEP-annotated tumour VCF | The tumour's variants, annotated with their protein consequences |
| Tumour sample | Which sample in the file is the tumour |
| Normal sample | The matched healthy sample, if the file has one |
| HLA Class I alleles | The patient's variants, written as `HLA-A*02:01` |
| Phased proximal variants VCF | Optional; nearby variants on the same chromosome copy |
| Peptide lengths | Fragment lengths to test (8, 9, 10, 11 by default) |
| Use PASS variants only | Skip variants the caller flagged as unreliable |
| Candidate peptides | How many top candidates to export |
| Worker threads | How many processor cores to use |

**The VCF must be annotated by VEP** (Ensembl's Variant Effect Predictor) first.
A plain variant file says where the DNA changed; the annotation says what that
does to the protein, which is what this tool needs. Liatir checks for the
annotation and refuses a file without it, rather than silently finding nothing.

**Phased proximal variants** matter when two mutations sit close together on the
same copy of a chromosome: the real protein carries both, so the fragment
sequence is different from what either mutation alone would give.

## Outputs

| Output | Meaning |
| --- | --- |
| Aggregated candidates | The main result: one ranked row per candidate |
| Filtered epitopes | Fragments that passed the binding and expression filters |
| All epitopes | Every fragment considered, before filtering |
| Candidate peptides | The best candidates as a FASTA file |
| Aggregated metrics, Run summary | Counts, settings and provenance |

Start from the aggregated candidates: the other files are there when you need to
see why something was kept or dropped.

## How it was checked

Before publication, the exact package ran on a real annotated tumour VCF: 40
variants produced 16,872 fragments, of which 16 passed the filters and 40 were
aggregated into candidates, 20 of them marked Pass, in 6 minutes 20 seconds on a
single thread.

## What the results mean

This tool prioritizes experimental candidates. It is not a validated vaccine,
therapy, or diagnostic result, and Liatir shows that notice with every result.
A ranked candidate is a starting point for laboratory work.

Liatir's pVACseq surface deliberately uses only the local MHCflurry predictors,
so nothing is sent to a prediction server. pVACtools upstream can call online
predictors; that path is not available here, by design.

## Licence and official source

- [pVACtools 7.1.2](https://github.com/griffithlab/pVACtools/blob/v7.1.2/LICENSE),
  BSD 3-Clause Clear.
- [MHCflurry](https://github.com/openvax/mhcflurry), Apache License 2.0, used as
  the predictor.
