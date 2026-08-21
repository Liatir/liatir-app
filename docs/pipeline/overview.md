# Pipelines

Pipelines let you connect analysis steps visually so that the output from one
step becomes the input for the next one.

Use pipelines when you want to repeat a workflow, avoid manual file handoffs,
or combine built-in tools, `.lia` plugins, AI Tools, and saved External
Workflows in one place.

## What a pipeline contains

A pipeline is made of nodes and connections:

- **Input nodes** provide starting files or values.
- **Tool nodes** run built-in tools, `.lia` plugins, AI Tools, or saved External
  Workflows.
- **Logic nodes** help control simple branching or conditional behavior.
- **Connections** pass compatible outputs into later inputs.

Each node exposes only the inputs that make sense for that tool. File pickers
are filtered by compatible format whenever possible.

## Running a pipeline

1. Open **Pipeline** from the sidebar.
2. Add the tools or plugins you want to use.
3. Connect outputs to compatible inputs.
4. Fill in required fields.
5. Click **Run pipeline**.

While a pipeline is running, it is locked to prevent accidental edits. You can
still work in other pipelines and elsewhere in the app.

## Starting from a preset

The Pipelines page includes small, editable workflows with their artifact
handoffs already connected. **Single-cell embedding and preview** asks only for
an AnnData file and an installed AI Model, then validates the input, creates an
immutable embedded AnnData result, opens its bounded preview, and leaves the
artifact in Data for later nodes.

## Jobs and Results

Long-running steps appear in **Jobs** while they run. When the pipeline
finishes, the completed run appears in **Results** with:

- the pipeline name;
- each step that ran;
- logs and errors;
- output files;
- metrics and summaries;
- provenance for tools and AI Models.

If a step fails, Liatir keeps the logs and shows which part of the pipeline
failed so you can fix the input or settings and run again.

## Example workflows

### FASTQ quality control

1. Start from FASTQ files in **Data**.
2. Run **FastQC**.
3. Run **fastp** to trim reads.
4. Add trimmed files back to **Data** or pass them to the next step.

### Variant filtering

1. Start from a VCF or BCF file.
2. Run **BCFtools stats** to inspect the callset.
3. Run **BCFtools filter** with a quality expression.
4. Review the filtered VCF in **Results**.

### AI-assisted workflows

1. Install a compatible AI Model.
2. Add an AI Tool to the pipeline.
3. Select the model inside the tool.
4. Connect the generated output to viewers, reports, or later tools.

Example AI pipelines:

- `.h5ad` file to [Single-cell Embedding](/ai/tools/single-cell-embedding) to an embedded AnnData artifact and [Single-cell Viewer](/visualization/single-cell-viewer).

Read [Local AI for bioinformatics](/ai/guide) before interpreting AI outputs.

### External workflow integration

A saved [External Workflow](/tools/external-workflows) appears as a reusable
pipeline node. Its declared files and parameters become node inputs, and only
its exact declared outputs are available to downstream nodes. The external
engine keeps ownership of its internal scheduling while Liatir keeps the parent
Pipeline Run, Job, Result and cross-tool provenance.

## Saving and reusing workflows

Pipelines are meant to be reusable. A saved workflow keeps its structure and
settings so you can return to it later, adjust inputs, and run it again.

An MCP-compatible client can also request an exact saved revision through
[Local MCP](/mcp/overview). This is off by default: you allow each saved
revision in Settings, choose which Data files and Results it may read, and
approve every individual run with its supplied inputs in Liatir.
Declared inputs include Native Tools, AI Tools and their compatible installed
AI Model choice, `.lia` Plugins, saved External Workflows, viewers, API
Connectors, utility nodes and nested sub-pipelines. MCP cannot install models or
edit pipeline and External Workflow definitions.

For custom steps, use [.lia plugins](/plugins/overview). A plugin can wrap a
script or command-line tool through the Liatir API bridge and still behave like a
normal node in the pipeline.
