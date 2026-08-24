# Tools

Liatir offers four kinds of analysis step: **built-in tools** that work out of
the box, **native tools** — real bioinformatics programs, shipped with Liatir —
**AI Tools** that use local AI Models, and **External Workflows** that run saved
engine projects such as Nextflow.

They all share the same layout, run history, and results view, and they can be
mixed freely in a pipeline whenever their inputs and outputs match.

## Built-in tools

Bundled with Liatir, so there is nothing to install. They work identically on
every machine.

| Tool | Description |
|------|-------------|
| [FastQC](/tools/fastqc) | Per-base quality, GC content, adapter detection, duplication levels |

## Native tools

These are real bioinformatics programs, and Liatir ships them. You do not install
`samtools`, `bwa`, `minimap2`, `bcftools`, `seqkit`, `fastp`, `simpleaf` or
`alevin-fry` yourself: they arrive with the application, at the exact versions it
was tested with, and they update when Liatir updates. The tool page shows
**Included with Liatir** and the version it is running.

SnpEff is the exception: it is a Java program with its own separately managed
databases, so it still needs a Java runtime on your machine.

On **Windows** these tools run inside WSL2 — see
[Windows and WSL2](#windows-and-wsl2) below.

| Tool | Subcommand | Input formats |
|------|-----------|---------------|
| [seqkit stats](/tools/seqkit) | `stats` | FASTA, FASTQ (compressed or not) |
| [Samtools](/tools/samtools) | `flagstat` | BAM, SAM, CRAM |
| [Samtools faidx](/tools/samtools-faidx) | `faidx` | FASTA, FASTA.GZ |
| [BWA-MEM](/tools/bwa-mem) | `mem` | FASTA + FASTQ |
| [Minimap2](/tools/minimap2) | — | FASTA/MMI + FASTQ/FASTA |
| [BCFtools](/tools/bcftools) | `stats` | VCF, VCF.GZ, BCF, BCF.GZ |
| [BCFtools filter](/tools/bcftools-filter) | `filter` | VCF, VCF.GZ, BCF, BCF.GZ |
| [SnpEff](/tools/snpeff) | — | VCF, VCF.GZ |
| [fastp](/tools/fastp) | — | FASTQ (single or paired-end) |
| [Single-cell Reference Index](/tools/single-cell-index) | `simpleaf index` | Genome FASTA + GTF/GFF3 |
| [Single-cell Quantification](/tools/single-cell-quant) | `simpleaf quant` | Single-cell index + paired FASTQ |

The two single-cell steps are one toolchain: `simpleaf` drives `piscem` for
mapping and `alevin-fry` for counting, so you run one step instead of five. The
result is an `.h5ad` count matrix, which is the input the
[Single-cell Embedding](/ai/tools/single-cell-embedding) AI Tool and the
[Single-cell Viewer](/visualization/single-cell-viewer) expect.

Common single-cell references can be selected from a ready-made list. Liatir
downloads each index once, verifies it and keeps it for reuse; the reference
index tool remains available for species or annotation releases not in that
list.

### Windows and WSL2

Almost none of this software has a Windows build. `samtools`, `bcftools`, `bwa`,
`minimap2`, `fastp`, `simpleaf` and `alevin-fry` are written for Unix and rely on
operating-system facilities Windows does not provide; their authors publish Linux
and macOS releases only. This is not a Liatir limitation and no Windows version
exists to package.

So Liatir on Windows ships the Linux tools and runs them through **WSL2**, the
Windows Subsystem for Linux — the same mechanism it already uses for
[Nextflow](/tools/external-workflows). You still work entirely in the Liatir
window; your files stay where they are, and Liatir translates their locations for
the tool.

**WSL2 must be installed.** It is a supported Windows feature, not third-party
software: open PowerShell as administrator, run `wsl --install`, and restart when
asked. You do not need to install anything inside it for these tools — Liatir
brings its own copy and sets it up for you. Nextflow is different and does need
to be installed inside WSL2 yourself.

Liatir unpacks its tools the first time it starts after being installed or
updated. It takes a second or two, happens in the background, and does not repeat.

## AI Tools

AI Tools are documented separately because interpreting their results requires
model-specific context.

| AI Tool | Description |
| --- | --- |
| [Single-cell Embedding](/ai/tools/single-cell-embedding) | Foundation-model cell embeddings from `.h5ad` inputs |

Start with [Local AI for bioinformatics](/ai/guide) if you are new to these
outputs.

## External Workflows

External Workflows can run on their own or as one reusable node in a Liatir
pipeline. The first adapter uses a system-installed Nextflow and Java runtime.

| Engine | Description |
| --- | --- |
| [Nextflow](/tools/external-workflows) | Saved local or revision-pinned workflows with declared inputs, exact outputs and engine provenance |

## Scientific viewers

Viewers inspect output artifacts produced by tools and pipelines.

| Viewer | Description |
| --- | --- |
| [3D Structure Viewer](/visualization/structure-viewer) | PDB/mmCIF/CIF structure inspection |
| [Genome Track Viewer](/visualization/genome-track-viewer) | BED and genome-track inspection |
| [Single-cell Viewer](/visualization/single-cell-viewer) | profiled AnnData and bounded embedding previews |

## Common UI pattern

Every tool page follows the same layout:

1. **Dependency check** — if a required native binary or workflow engine is missing, Liatir explains what is needed.
2. **Input form** — file pickers pre-filtered by compatible extension, plus any tool-specific options.
3. **Run button** — starts the analysis and streams progress or logs when available.
4. **Results panel** — shows parsed stats, tables, text output, charts, and generated files.
5. **Run history sidebar** — all past runs for this tool, selectable to re-display their results.

## Result views

Tool results are displayed in a consistent format:

- stats appear as readable key-value grids;
- long text output can be expanded when needed;
- charts are interactive where available;
- generated files appear above the report with actions.

## Output files

Some tools produce output files as part of their results. These appear in the results panel above the stats sections, with two actions:

- **Add to Data** — registers the file in the Data library immediately, making it available as an input to the next step.
- **Save as…** — opens the system save dialog so you can copy the file to a location of your choice.

## Run history

Each tool keeps a persistent run history. Selecting a past run in the sidebar
re-renders its output without re-running the tool. Run records include:

- Tool name and version
- Input file paths
- Parsed results
- Output file references
- Timestamp

### What a run writes down

A run records everything it did, not only what it was asked for.

**Every file it produced.** Each run has its own folder, and everything the tool
wrote goes in it — the result, plus whatever it produced along the way: fastp's
quality report, the log and execution report a Nextflow workflow leaves behind,
working files. The results panel lists the results and tells you how many other
files there are; **Open run folder**, next to **View log** under any run, shows
them in Finder or Explorer. It is there on every screen that displays a run — the
tool page, the Results screen, AI Tools, External Workflows — including for a run
that failed, which is when you are most likely to want it.

The same is true of a step inside a pipeline: it is a run like any other and has its
own folder. Where you *find* your results does not change — they still appear under
**Results** in your Data library, grouped by tool.

This matters for a specific reason: some files are written next to *your* files,
under your own filenames — the index `bwa` builds beside your reference the first
time you align against it. A tool that quietly creates five files in your folder and
never says so is a tool you cannot audit, so those are recorded with the run too.

**The complete log.** The run keeps everything the program printed, including its
error output, marked as such. It is the full record, not the trimmed version shown
while the run is in progress, and it is kept for as long as the run itself — so a
result from two months ago can still be explained.

**Nothing is deleted for you.** Liatir never removes a run on its own, however long
the history gets, because a run holds files you made and may still be using. When you
want the space back, the Results screen offers an action that deletes older runs — it
tells you first how many files go with them and how many of those are in your Data
library.

## Pipeline integration

Tools and saved External Workflows expose compatible inputs and outputs to the
pipeline builder. This allows an output file from one step to be connected to a
compatible input in the next step. See [Pipeline Overview](/pipeline/overview)
for details.
