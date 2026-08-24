# Single-cell Quantification

Turns raw single-cell sequencing reads into a **count matrix**: a table with one
row per cell, one column per gene, and in each box the number of times that gene
was read in that cell. It is written as an AnnData `.h5ad` file — the format the
[Single-cell Embedding](/ai/tools/single-cell-embedding) AI Tool reads.

Liatir drives this with `simpleaf`, which runs the whole chain for you: mapping
with `piscem`, then cell detection, collation and UMI counting with `alevin-fry`.
You run one step, not five.

## Use it for

- 10x Genomics 3′ and 5′ single-cell RNA-seq;
- producing the `.h5ad` input the single-cell AI Tools and the
  [Single-cell Viewer](/visualization/single-cell-viewer) expect;
- re-quantifying a sample against a different annotation release.

## Inputs

- **Single-cell index** — produced by
  [Single-cell Reference Index](/tools/single-cell-index).
- **Reads R1** — the short read carrying the cell barcode and the UMI.
- **Reads R2** — the read carrying the transcript sequence.
- **Chemistry** — the kit the library was made with. Getting this wrong makes
  almost nothing map, so check it first when a run comes back near zero.
- **Which droplets are cells** — see below.
- **UMI resolution** — how a read that could belong to more than one gene is
  counted.
- **Threads.**

### Which droplets are cells

Most droplets in a single-cell run contain no cell. Three ways to decide:

| Option | What it does | When to use it |
| --- | --- | --- |
| Detect cells automatically | Finds the drop between real cells and empty droplets | The default. Needs nothing from you |
| Use my barcode list | Quantifies exactly the barcodes in a file you supply, one per line | You already know which cells you want |
| Keep a fixed number of cells | Takes the N barcodes with the most reads | You know roughly how many cells were loaded |

### UMI resolution

A UMI is a random tag attached to each original molecule, so the same molecule
read ten times is counted once. When a read could have come from more than one
gene, the resolution mode decides what happens:

- **Standard (CellRanger-like)** — the default. Whole counts, and what most
  published analyses use.
- **Parsimony** modes — whole counts, resolved differently.
- **Shared reads (EM)** modes — split an ambiguous read between the genes it
  could belong to, so counts can be fractional (1.4 copies of a gene).

Fractional counts are a legitimate estimate, but they are **not raw counts**.
Liatir records that on the file, and a tool that requires raw counts will refuse
it rather than produce a quiet wrong answer.

## Outputs

- **Count matrix (AnnData)** — the `.h5ad` file.
- Run summary: cells, genes, percentage of reads mapped, percentage of barcodes
  kept, and how the matrix was made.

## How to read the result

- **Reads mapped** below roughly 50% usually means the wrong chemistry, or R1 and
  R2 the wrong way round.
- **Barcodes kept** counts reads whose barcode matched a real cell, including
  those rescued from a single-letter sequencing error.
- **Cells** far from what you loaded suggests the cell-detection option needs
  changing.

### What the counts include

Because the index is a spliced + intronic reference, the matrix holds
**spliced + unspliced + ambiguous** counts together, and keeps the three
separately as layers inside the same file. This is right for whole nuclei and
standard for droplet single-cell work; it is stated in the run log so it is never
an assumption.

### Gene names

Genes are named by the identifiers in your annotation. An Ensembl or GENCODE
release gives Ensembl IDs — which is what **Geneformer** expects. **UCE** and
**scGPT** expect gene symbols and will report the mismatch instead of running on
the wrong namespace. Symbols are stored alongside the identifiers when the
annotation carried them.

## What is not here yet

Liatir does not yet offer ready-made downloadable indexes for common species, so
the reference is built on your machine the first time. A sample split across
several FASTQ files per read also has to be concatenated before running.
