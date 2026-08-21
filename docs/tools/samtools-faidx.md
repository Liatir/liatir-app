# Samtools faidx

`samtools faidx` creates an index for a FASTA file and enables random-access extraction of subsequences by coordinate. The index is required by many downstream tools (GATK, BWA, bcftools) before they can process a reference genome.

## Details

| Property | Value |
|----------|-------|
| Type | Native tool |
| Binary | `samtools` |
| Subcommand | `faidx` |

## Installation

Nothing to install. This tool ships inside Liatir and runs at the version this
release was tested with; it updates when Liatir updates. The tool page shows
**Included with Liatir** and the version it is running.

On Windows it runs through WSL2 — see
[Windows and WSL2](/tools/overview#windows-and-wsl2).

## Accepted inputs

| Extension | Description |
|-----------|-------------|
| `.fasta`, `.fa`, `.fna` | Uncompressed FASTA (required for indexing) |
| `.fasta.gz`, `.fa.gz` | Bgzip-compressed FASTA (requires bgzip, not regular gzip) |

::: warning gzip vs bgzip
`samtools faidx` can only index FASTA files compressed with **bgzip**, not regular gzip. A bgzip-compressed file has the same `.gz` extension but a different internal format. If indexing fails on a `.gz` file, decompress it with `gunzip` and re-index the uncompressed version.
:::

## Usage

### Create index

1. Navigate to **Tools → Samtools faidx**.
2. Select a FASTA file from your Data library.
3. Click **Create index**.

Liatir runs `samtools faidx <file>`, which creates `<file>.fai` in the same directory. The index file is automatically registered in the Data library.

The results panel shows a table of all sequences in the FASTA with their lengths.

### Extract subsequence

With a file selected and an existing `.fai` index, use the **Extract subsequence** form:

1. Enter a region string in the format `chr:start-end` (1-based, inclusive).
2. Click **Extract**.

The extracted FASTA sequence is displayed inline. Examples:

| Region string | Extracts |
|---------------|---------|
| `chr1` | Entire chromosome 1 |
| `chr1:1-1000` | First 1000 bases of chr1 |
| `chr17:7,668,421-7,687,538` | TP53 locus |

## The .fai index format

The `.fai` file is a tab-separated text file with one line per sequence:

```
NAME    LENGTH    OFFSET    BASES_PER_LINE    BYTES_PER_LINE
chr1    248956422    52    60    61
chr2    242193529    253404903    60    61
```

| Column | Description |
|--------|-------------|
| NAME | Sequence name from the `>` header (up to first whitespace) |
| LENGTH | Sequence length in bases |
| OFFSET | Byte offset of the first base in the FASTA file |
| BASES_PER_LINE | Number of bases per line |
| BYTES_PER_LINE | Bytes per line (includes newline) |

The index allows tools to jump directly to any position in the file without reading from the start.
