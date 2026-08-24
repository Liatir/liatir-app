# Single-cell RNA-seq vertical (alevin-fry)

Status: **built, locally verified and production infrastructure deployed.** Liatir
takes raw single-cell reads to an `.h5ad` count matrix without asking the user to
install anything. Ready-made index distribution is implemented from CI producer
to native app lifecycle; the first real index publication is in progress.

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

### Ready-made reference indexes

The common path no longer asks the user to find GENCODE files or build an index.
Both single-cell tool pages show a catalog dropdown with the full scientific
identity: species, assembly, annotation provider/release, spliced+intronic
construction and R2 read length. The first approved recipe is human GRCh38,
GENCODE v47 primary assembly, spliced+intronic, R2 91 bases. The custom local
builder remains below it for an unusual species or release.

The distribution path is deliberately scientific data, not another executable
Runtime Box. `.github/workflows/single-cell-index-release.yml` downloads the
checksummed GENCODE sources, builds with the committed Linux Native Tools pixi
lock, packages a deterministic ZIP, uploads immutable content-addressed bytes
through the existing Registry Worker, verifies the complete public SHA-256,
then signs and promotes the merged catalog. CI never receives an R2 API token.
Its Google identity provider is pinned to that exact manual workflow.

The signer allowlist binds the complete scientific choice and source checksums,
not merely an archive name. The Worker re-verifies the signature and exact R2
origin/path before promotion. The app verifies the catalog signature, archive
size/SHA-256, safe ZIP paths and every extracted file, activates by rename,
caches the signed catalog for offline use, re-verifies before reuse, and removes
only the exact selected identity. Installed manifests are normal
`*.sc-index.json` values, so quantification did not gain a second input path.

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

**Production activation.** The workflow-specific Google identity is active, the
Registry Worker is version `bd570562-1ccf-491f-a779-d94bb0f3986c`, and protected
signer deployment run `32688008078` passed its real KMS smoke test on exact `main`.
The first index run, `32688392977`, reached the real simpleaf build but the standard
GitHub runner exhausted its disk before upload or signing. The regression now
reclaims only explicit unused SDK paths on the ephemeral hosted runner and requires
40 GB free before downloading the genome. Its test is in
`tests/unit/single-cell-index-distribution.test.ts`. Retry limit: one run from the
fixed exact `main`; if that still exhausts disk, stop and move the producer to a
larger runner rather than adding unbounded cleanup.

The remaining activation evidence is the successful retry plus read-back of the
immutable archive and signed catalog. Until both exist, the first real index is not
published and the catalog correctly remains absent.

The original reasons for this shape remain:

- There is no single "human index". There is a matrix of choices — species, then
  annotation release (GENCODE v44/v45/v46…), then variant (with or without
  introns). Results across annotation releases are not comparable, so the choice
  is a scientific one and Liatir cannot make it silently. It is a dropdown, not a
  default.
- Shipping one in the installer would make every user pay for it, including
  everyone who never runs single-cell.
- Building on the user's machine costs minutes and RAM on first use and puts a
  step before the first result, which is where a non-technical user is lost.

The local index step remains intentional: a user with an unusual species or a
specific annotation release will always need it. Mouse and later human releases
are additions to `single-cell-indexes/recipes.json` plus signer review; they must
not be silently substituted for the first approved identity.

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
