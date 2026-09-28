# Demo files are real datasets, one folder per task

Taken 2026-09-28, at the maintainer's request to make the Sandbox demo files fit the AI Models and
real use cases, and to name them so their purpose is obvious.

## Decision

The bundled demo set is **real, published data**, cut down to a size that runs in seconds to
minutes, and organised as **one folder per task a user wants to do**, named in plain words
("Find mutations in a yeast genome", "Map blood cells with single-cell AI", …). Every folder holds
a `How to use these files.txt` with the tools to try, the exact settings and the data's source and
license. The contract and provenance are in [Demo files](../truth/demo-files.md).

## Why

The previous set was mostly invented sequence and did not work for what it was there to show:

- the demo FASTQ reads came from no part of the demo genome — 0 of 60 aligned — so BWA and
  Minimap2 demonstrated an empty result;
- the SAM header named contigs the genome did not have;
- `pbmc68k_reduced.h5ad` is scaled data over 765 genes, which the single-cell AI Models reject by
  design, and `pbmc3k_raw.h5ad` had no Ensembl IDs where Geneformer reads them;
- proteins were 40-residue random strings and the structure a 3-residue, 14-atom peptide;
- nothing fed MHCflurry, pVACseq or simpleaf;
- the production bundle did not include the directory at all, so released builds had no demo files.

A demo that fails, or succeeds on meaningless input, teaches a non-technical user that the tool is
broken. Real data with a known answer (a 12 nM drug that must come out as a binder, a crystal
structure to compare a prediction with, a KRAS neoantigen that the normal peptide is not) shows
what the tool is for.

## Rejected

- **Folders named by file format** (`fasta/`, `vcf/`): a user thinks in tasks, not formats.
- **Tool names in folder or file names**: they go stale as tools are added or replaced, and grow
  long. The tools are named inside each folder's instructions instead.
- **Human variant calling for the SnpEff demo**: the human database is an 807 MB download; yeast
  R64-1-1 is 6 MB and runs the same tools end to end.
- **A BAM for the Genome Track Viewer**: the viewer does not pass a BAI to JBrowse yet, so it would
  demonstrate an error.
- **Bumping a version number to refresh installed copies**: easy to forget. The manifest hashes
  every file and a unit test fails when it is stale, so the refresh cannot be skipped.
- **Keeping the old files beside the new ones**: installs would show both sets, and old copies
  would keep pointing at scientifically meaningless data.
