# Tools

Liatir ships with two categories of built-in analysis tools: **WASM plugins** that run entirely inside the app with no installation, and **native tools** that delegate to binaries you have installed in your system PATH.

Both categories share the same UI pattern, run history, and output model — they are interchangeable from the pipeline's perspective.

## WASM plugins

Compiled to WebAssembly and bundled with Liatir. Zero installation required. These tools work identically on every machine.

| Tool | Description |
|------|-------------|
| [FastQC](/tools/fastqc) | Per-base quality, GC content, adapter detection, duplication levels |

## Native tools

Require the corresponding binary to be in your system PATH. Liatir checks availability when you open the tool page and surfaces install instructions (Homebrew, apt, conda) if the binary is missing.

| Tool | Binary | Subcommand | Input formats |
|------|--------|-----------|---------------|
| [Samtools](/tools/samtools) | `samtools` | `flagstat` | BAM, SAM, CRAM |
| [BCFtools](/tools/bcftools) | `bcftools` | `stats` | VCF, VCF.GZ, BCF, BCF.GZ |
| [fastp](/tools/fastp) | `fastp` | — | FASTQ (single or paired-end) |

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
