# Single-cell RNA-seq vertical (alevin-fry)

Status: **built, on the machine.** Liatir takes raw single-cell reads to an
`.h5ad` count matrix without asking the user to install anything. What is *not*
built is the published-index distribution described under "Still open" — today the
reference index is built locally, once, by a step in the app.

## Why this vertical

Liatir starts where RNA-seq ends: the `.h5ad` files the single-cell AI Tools
consume *are* the output of an RNA-seq pipeline. Someone holding raw reads
cannot reach the point where the product's best feature begins. This vertical
closes that gap, and it is the reason alevin-fry outranks HISAT2 (bulk, whose
downstream is R and DESeq2 — a language Liatir does not host) and STARsolo
(STAR, so the ~30 GB indexing memory wall).

## What shipped

Two pipeline steps, in `frontend/src/lib/tools/single-cell/simpleaf.ts`:

- **Single-cell Reference Index** (`simpleaf-index`) — genome FASTA + GTF/GFF3 →
  a spliced+intronic index. Built once per species and annotation release.
- **Single-cell Quantification** (`simpleaf-quant`) — index + R1/R2 → an
  `.h5ad` count matrix, with cells, genes and mapping rate as connectable values.

`simpleaf`, `alevin-fry` and `piscem` are in the bundled Native Tools box. Liatir
calls `simpleaf` and nothing else: it drives piscem for mapping and alevin-fry for
permit list, collation and UMI resolution. Three engines that can each fail
differently become one command that fails once, which is the difference between a
tool a non-technical user can run and one they cannot.

### The conversion problem dissolved

`simpleaf quant --anndata-out` writes the `.h5ad` itself, in Rust, from the same
matrix-market matrix it writes to disk. **Liatir has no second implementation of
the AnnData format, and must never grow one.** This was the one piece of real new
work the earlier version of this document predicted, and the prediction was wrong:
it was already solved upstream in simpleaf 0.28.

What that avoided is worth recording. The alternative was Python — `anndata` plus
`pandas`, `scipy` and `numpy` — which measured **542 MB installed** against 488 MB
for the box as it now stands. `pyroe`, the upstream converter, additionally pulls
all of scanpy. Either would have made a single-cell dependency mandatory for every
user of the app, which the AGENTS.md invariant on heavy dependencies forbids.

### What a quantification declares about itself

The scientific facts come from the run's own reports (`quant.json`,
`map_info.json`, `generate_permit_list.json`, `quants_mat_cols.txt`), never from
re-reading a matrix that is hundreds of megabytes on a real experiment:

- **A spliced+intronic index always quantifies in USA mode**, so `X` holds
  spliced + unspliced + ambiguous counts, and the three are kept separately as
  layers. The step says so in its log rather than letting the user assume `X` is
  exonic counts.
- **`-em` resolutions produce fractional counts**, so the artifact declares
  `expected-counts`, not `raw-counts`. A tool that requires raw counts then
  refuses the matrix, which is correct — and the default (`cr-like`) is whole.
- **The feature namespace is named only when it can be recognised.** Ensembl gene
  IDs are; gene symbols are arbitrary words and are not, so unknown stays
  unknown and the artifact is partially validated. That is the truth, and it is
  what `valid-or-partial` exists for.

Gene identifiers in `var` come from the annotation. An Ensembl or GENCODE GTF
therefore produces Ensembl IDs, which is what **Geneformer** wants; **UCE** and
**scGPT** want symbols, and will report the mismatch rather than run on the wrong
namespace. Symbols are present as `var['gene_symbol']` when the annotation carried
them; converting between the two is not this vertical's job.

### The index is a file, deliberately

A directory is not a pipeline value, and `packages/liatir-core` allows
`file`, `string`, `number`, `boolean`, `stats`, `json` — no `directory`. Rather
than grow that union, the index step emits a small JSON manifest naming the
directory and the maps beside it (`packages/liatir-core/src/single-cell.ts`,
`*.sc-index.json`), and the quantification step reads it.

This is the seam the published-index direction needs: whatever produces an index
writes one of these, so a downloaded index drops in without the quantification
step changing at all.

### Cost of the box line

Adding `simpleaf` + `alevin-fry` (which bring `piscem` and `libjemalloc`) grew the
macOS box from 341 MB to 488 MB installed, and **+31 MB compressed** in the
installer. Every new package is permissive — BSD-3-Clause for the three tools,
BSD-2-Clause for jemalloc — and the reviewed audits under
`runtime-boxes/legal/audits/` were regenerated with `scrollcase audit --write`;
the box build refuses to proceed otherwise.

The box's self-test now runs the whole chain: it builds a small genome and
annotation, indexes it, quantifies three synthetic cells, and asserts the exact
spliced, unspliced and ambiguous count of every cell and gene against the
matrix-market output, plus the HDF5 signature of the `.h5ad`. Counts are exact
because the synthetic reads carry enumerated, distinct UMIs. A box that cannot do
single-cell can no longer be packaged.

## Still open

**Published reference indexes.** The settled direction remains: *indexes are built
in CI, published to R2, and downloaded by the app when the user picks one* — not
shipped inside the installer, and not built on every user's machine. The reasons,
kept because they are what makes the decision hold:

- There is no single "human index". There is a matrix of choices — species, then
  annotation release (GENCODE v44/v45/v46…), then variant (with or without
  introns). Results across annotation releases are not comparable, so the choice
  is a scientific one and Liatir cannot make it silently. It is a dropdown, not a
  default.
- Shipping one in the installer would make every user pay for it, including
  everyone who never runs single-cell.
- Building on the user's machine costs minutes and RAM on first use and puts a
  step before the first result, which is where a non-technical user is lost.

**None of that is built.** There is no workflow that builds or publishes an index.
What exists today is the local index step, which is honest work — a user with an
unusual species or a specific annotation release will always need it — but it is
not the path a first-time user should be on for human or mouse.

The product shape already exists in the app: SnpEff's genome databases
(`frontend/src/lib/stores/snpeff.svelte.ts` — `downloadedGenomes`, download on
demand, marked as present, removable) are the same pattern applied to a different
tool. Index distribution is that pattern, plus a CI producer, plus a manifest
writer — and the manifest already exists.

Whether indexes reuse the Runtime Box spine (`.github/workflows/runtime-box-*.yml`,
`workers/runtime-box-registry`, `services/runtime-box-signer`) or get a simpler
unsigned asset path on the same bucket is still open. A transcriptome index built
from a public annotation is not a model weight and does not obviously need KMS
signing, but it does need a checksum the app can verify offline.

**Barcode permit lists stay local.** simpleaf's `--unfiltered-pl` downloads the
manufacturer barcode list from a remote URL, which an offline-first app cannot
depend on. Liatir exposes knee detection (the default, needs nothing), an explicit
barcode list the user supplies, and a forced cell count. Shipping the 10x
unfiltered lists is a distribution question, and belongs with the index one.

**Multiple FASTQ files per sample.** simpleaf accepts comma-separated lists for
`--reads1`/`--reads2`; a pipeline `file` input is one path. A sample split across
lanes has to be concatenated first. Worth revisiting when a real user hits it.

## Measured (2026-08-24, `pixi lock` on conda-forge + bioconda)

| package | version | osx-arm64 | linux-64 |
|---|---|---|---|
| `alevin-fry` | 0.18.0 | 2 packages | 5 packages |
| `salmon` | 2.5.1 | 1 package | 4 packages |
| `piscem` | 0.22.1 | 4 packages | 7 packages |
| `simpleaf` | 0.28.0 | 6 packages (pulls `alevin-fry` + `piscem`) | 9 packages |

`salmon` is not in the box. bioconda's `simpleaf` brings `piscem`, and piscem is
the mapper simpleaf drives; salmon would be a second mapper for the same job.

Sizes on `osx-arm64`: the six-tool box was 341 MB installed; with the three new
binaries it is 488 MB installed and +31 MB compressed. `simpleaf` is 104 MB of
that, `piscem` 38 MB, `alevin-fry` 5 MB.
