# Single-cell Reference Index

Builds the reference a single-cell experiment is measured against, from a genome
and its annotation.

For a common reference, start with **Ready-made reference** at the top of the
tool. Choose the species, genome assembly, annotation release and read length;
Liatir downloads the finished index once, verifies it, and reuses it for later
samples. You can remove the local copy from the same panel.

## What an index is, in one paragraph

Sequencing gives you millions of short pieces of text. An index is a lookup table
that lets Liatir work out, quickly, which gene each piece came from. Without one,
every read would have to be compared against the whole genome, which is far too
slow to be practical.

## Use it for

- downloading a listed reference without finding genome files or building it;
- preparing a custom species once, before quantifying any number of samples;
- a species or annotation release Liatir does not provide ready-made;
- reproducing an analysis against a specific annotation version.

## Inputs

The ready-made list shows every scientific choice that affects the result. If
the reference you need is not listed, build a custom one with:

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

A ready-made index needs only one download. Liatir checks the signed catalog,
the archive checksum and every extracted file before the index becomes usable;
the verified copy also works offline.

Building a custom index reads the entire genome and needs a few gigabytes of
memory. On a human genome it takes minutes rather than seconds. Either route is
done **once** per species and annotation release — every sample afterwards
reuses the same index.

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
