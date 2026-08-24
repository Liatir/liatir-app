# Single-cell Reference Index

Builds the reference a single-cell experiment is measured against, from a genome
and its annotation.

## What an index is, in one paragraph

Sequencing gives you millions of short pieces of text. An index is a lookup table
that lets Liatir work out, quickly, which gene each piece came from. Without one,
every read would have to be compared against the whole genome, which is far too
slow to be practical.

## Use it for

- preparing a species once, before quantifying any number of samples;
- a species or annotation release Liatir does not provide ready-made;
- reproducing an analysis against a specific annotation version.

## Inputs

- **Genome FASTA** — the species genome, as downloaded from Ensembl or GENCODE.
- **Annotation (GTF or GFF3)** — where the genes are in that genome.
- **Read length** — the length of the cDNA read (R2) in the samples this index
  will be used for. 91 suits 10x 3′ v3.
- **Threads.**

The annotation must be the release that goes with the genome. Results produced
against two different annotation releases are not comparable, and Liatir will not
guess for you: it is a scientific choice.

## Outputs

- A **single-cell index** file. It is small — it describes where the index is and
  what it was built from. Connect it to
  [Single-cell Quantification](/tools/single-cell-quant).

## What to expect

Building an index reads the entire genome and needs a few gigabytes of memory. On
a human genome it takes minutes rather than seconds. It is done **once** per
species and annotation release — every sample afterwards is fast.

The index is built as a *spliced + intronic* reference, which means reads coming
from unfinished transcripts (the parts of a gene that are normally cut out) are
counted rather than discarded. That is what makes the result usable for whole
nuclei as well as whole cells, and it is why the counts you get later include an
intronic component.

## How to read the result

The run summary tells you two things worth checking:

- whether the annotation carried **gene symbols**. If it did, the count matrix
  will name genes by symbol as well as by identifier;
- what the index was built from, so an analysis can be traced back to the exact
  genome and annotation files.
