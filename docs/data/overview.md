# Data

The Data page is the central file registry for Liatir. Every tool and plugin draws its input files from here. You add files once; everything else in the app can see them.

## How files are stored

Files are imported **by reference** — Liatir records the absolute path, not a copy of the file. Your data stays exactly where it is. There are no uploads, no hidden copies, and no size limits on import.

This design matters for bioinformatics because the files are large. A whole-genome BAM can be 100 GB. Copying it would be wasteful and slow. Liatir reads files directly from disk when a tool needs them.

## Importing files

Click **Add files** on the Data page, or drag and drop one or more files onto the list. Any number of files can be imported at once.

After import, each file is registered with:
- Absolute path on disk
- Detected extension and format type
- File size
- Import timestamp

## Supported formats

| Format | Extension(s) | Preview |
|--------|-------------|---------|
| FASTQ | `.fastq`, `.fastq.gz`, `.fq`, `.fq.gz` | Text (uncompressed only) |
| FASTA | `.fasta`, `.fa`, `.fna`, `.faa`, `.fna.gz` | Text (uncompressed only) |
| BAM | `.bam` | Binary — no preview |
| SAM | `.sam` | Text |
| CRAM | `.cram` | Binary — no preview |
| VCF | `.vcf`, `.vcf.gz` | Text (uncompressed only) |
| BCF | `.bcf`, `.bcf.gz` | Binary — no preview |
| GTF / GFF | `.gtf`, `.gff`, `.gff3` | Text |
| BED | `.bed` | Text |

Some tools can read compressed files even when the Data preview cannot display
them. For example, genomic variant scoring accepts both `.vcf` and `.vcf.gz`;
the preview panel still treats `.vcf.gz` as compressed data.

## File preview

Click any file row to open the preview panel on the right side. Liatir reads only the first lines needed for the preview, so you can inspect large text files without loading the whole file into memory.

The preview is format-aware:

**FASTQ** — lines are grouped into 4-line records and each line type gets its own colour:
- `@` header lines are highlighted in blue
- Sequence lines are shown in green
- `+` separator lines are muted
- Quality score lines are shown in amber

**FASTA** — `>` header lines are highlighted to visually separate records from sequence data.

**VCF** — `##` meta-information lines are rendered in a muted grey to distinguish them from data variant records. `#CHROM` header line is highlighted.

**SAM** — `@` header lines are highlighted; alignment records are plain.

**GTF / BED** — plain text with no extra highlighting; column structure is preserved.

::: warning Binary and compressed formats
BAM, CRAM, BCF, and `.gz` files are flagged as binary. The preview panel shows a notice for these formats. Use the appropriate tool (Samtools, BCFtools) to inspect binary contents.
:::

## Missing file detection

When the app starts — and whenever you navigate to the Data page — Liatir checks that every registered file still exists at its recorded path. Files that cannot be found are shown with a warning indicator.

To fix a missing file, click **Relocate** and pick the new path. The path reference is updated in place; the run history and any pipeline definitions that reference this file continue to work.

## Output files from tools

When a tool produces output files (e.g., fastp's trimmed FASTQ), the results panel shows an **Add to Data** button for each output file. Clicking it registers the file in the Data library so it is immediately available as an input to the next step. No manual import needed.

## Filtering by extension

Tool pages that require a specific file type (e.g., Samtools only accepts BAM/SAM/CRAM) pre-filter the Data library's file picker by extension. Only compatible files are shown in the dropdown. This prevents mismatched inputs at the UI level.
