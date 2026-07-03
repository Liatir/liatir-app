# Tools

Liatir ships with three built-in analysis surfaces: **WASM plugins** that run
inside the app, **native tools** that delegate to binaries installed on your
machine, and **AI Tools** that use local AI Models.

All of them share the same UI pattern, run history, and output model. They are
interchangeable from the pipeline's perspective when their input and output
types match.

## WASM plugins

Compiled to WebAssembly and bundled with Liatir. Zero installation required. These tools work identically on every machine.

| Tool | Description |
|------|-------------|
| [FastQC](/tools/fastqc) | Per-base quality, GC content, adapter detection, duplication levels |
| [seqkit stats](/tools/seqkit) | FASTA/FASTQ sequence counts, GC, length, N50 |

## Native tools

Require the corresponding binary to be in your system PATH. Liatir checks availability when you open the tool page and surfaces install instructions (Homebrew, apt, conda) if the binary is missing.

| Tool | Binary | Subcommand | Input formats |
|------|--------|-----------|---------------|
| [Samtools](/tools/samtools) | `samtools` | `flagstat` | BAM, SAM, CRAM |
| [Samtools faidx](/tools/samtools-faidx) | `samtools` | `faidx` | FASTA, FASTA.GZ |
| [BWA-MEM](/tools/bwa-mem) | `bwa` | `mem` | FASTA + FASTQ |
| [Minimap2](/tools/minimap2) | `minimap2` | — | FASTA/MMI + FASTQ/FASTA |
| [BCFtools](/tools/bcftools) | `bcftools` | `stats` | VCF, VCF.GZ, BCF, BCF.GZ |
| [BCFtools filter](/tools/bcftools-filter) | `bcftools` | `filter` | VCF, VCF.GZ, BCF, BCF.GZ |
| [SnpEff](/tools/snpeff) | `java` + SnpEff JAR | — | VCF, VCF.GZ |
| [fastp](/tools/fastp) | `fastp` | — | FASTQ (single or paired-end) |

## AI Tools

AI Tools are documented separately because interpreting their results requires
model-specific context.

| AI Tool | Description |
| --- | --- |
| [CellTypist Annotation](/ai/tools/celltypist-annotation) | Single-cell cell-type labels from `.h5ad` inputs |
| [Sequence Embedding](/ai/tools/sequence-embedding) | DNA/RNA/protein sequence embeddings |
| [Genomic Variant Effect](/ai/tools/genomic-variant-effect) | Embedding-delta scores for variants |
| [Regulatory Prediction](/ai/tools/regulatory-prediction) | Predicted regulatory signal tracks |
| [Protein Structure Prediction](/ai/tools/protein-structure-prediction) | Protein 3D structure prediction |

Start with [Local AI for bioinformatics](/ai/guide) if you are new to these
outputs.

## Scientific viewers

Viewers inspect output artifacts produced by tools and pipelines.

| Viewer | Description |
| --- | --- |
| [3D Structure Viewer](/visualization/structure-viewer) | PDB/mmCIF/CIF structure inspection |
| [Genome Track Viewer](/visualization/genome-track-viewer) | BED and genome-track inspection |
| [Single-cell Viewer](/visualization/single-cell-viewer) | single-cell labels and preview artifacts |

## Common UI pattern

Every tool page follows the same layout:

1. **Dependency check** — if a native binary is missing, Liatir shows installation instructions.
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

## Pipeline integration

Tools expose compatible inputs and outputs to the pipeline builder. This allows
an output file from one step to be connected to a compatible input in the next
step. See [Pipeline Overview](/pipeline/overview) for details.
