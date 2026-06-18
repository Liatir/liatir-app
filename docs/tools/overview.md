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

1. **Dependency check** — on page load, Liatir calls `lia_deps_check` (for native tools). If the binary is not found, a card appears with installation instructions.
2. **Input form** — file pickers pre-filtered by compatible extension, plus any tool-specific options.
3. **Run button** — spawns the process via `lia_jobs_spawn` and streams output.
4. **Results panel** — renders the parsed `ToolOutput` via `ToolResultView` (stats grids, text sections, Plotly charts).
5. **Run history sidebar** — all past runs for this tool, selectable to re-display their results.

## ToolOutput format

Every tool produces a `ToolOutput` value that is rendered by `ToolResultView`:

```typescript
interface ToolOutput {
  sections: ToolSection[]
}

// Section types:
type ToolSection =
  | { type: 'stats';  title: string; stats: Record<string, string | number> }
  | { type: 'text';   title: string; content: string }
  | { type: 'plotly'; title: string; data: PlotlyData }
  | { type: 'number'; title: string; value: number; unit?: string }
```

Stats sections become labelled key-value grids. Text sections are shown with line-count awareness (long outputs are truncated with a "show all" toggle). Plotly sections render interactive charts.

## Output files

Some tools produce output files as part of their results. These appear in the results panel above the stats sections, with two actions:

- **Add to Data** — registers the file in the Data library immediately, making it available as an input to the next step.
- **Save as…** — opens the system save dialog so you can copy the file to a location of your choice.

## Run history

Each tool keeps a persistent run history stored as JSON files in `{app_data_dir}/analysis-runs/<tool-name>/`. Selecting a past run in the sidebar re-renders its output without re-running the tool. Run records include:

- Tool name and version
- Input file paths
- Parsed `ToolOutput`
- Any `RunOutputFile` references
- Timestamp

## Pipeline integration

Every tool exposes a `PipelineStepDefinition` that describes its inputs and outputs. This is what allows tool outputs to be wired automatically to subsequent steps in a pipeline. See [Pipeline Overview](/pipeline/overview) for details.
