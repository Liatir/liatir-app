# What is Liatir

Liatir is a local-first bioinformatics desktop application. It runs bioinformatics tools (FastQC, Samtools, BCFtools, fastp, and more), custom plugins, local AI Models, and pipelines that connect steps together — all from a single visual interface, entirely on your own machine.

## Why local-first matters

Most modern bioinformatics platforms are cloud-based: you upload files to a remote server, pay per compute hour, and trust a third party with patient or proprietary data. Liatir takes the opposite approach.

- **Your data never leaves your machine.** No uploads. No API calls. No telemetry. Files are referenced by path — Liatir reads them directly.
- **Works offline.** Air-gapped HPC nodes, restricted institutional networks, no WiFi on a train — Liatir runs without any connectivity.
- **No subscriptions or rate limits.** Process as many samples as your local hardware allows.
- **Reproducible by default.** Every run stores its inputs, tool version, and parsed results locally. No external job IDs to chase, no logs that expire.
- **Built for large genomic files.** Whole-genome BAMs, dense multi-sample VCFs, and compressed FASTQs open and run without freezing the app.

## Three ways to extend Liatir

### Native tools
Liatir ships its common bioinformatics programs — samtools, bcftools, seqkit, fastp, bwa and minimap2 — so there is nothing to install or keep up to date. SnpEff and SnpSift are downloaded together only when needed, verified, and then managed by Liatir; their Java 21 runtime remains a system requirement. You choose the parameters, while run history and parsed results are stored automatically.

### Plugins
A `.lia` plugin is a self-contained extension that adds custom analysis steps. Plugins can be written in Python, Node, or compiled to WebAssembly, and appear as normal tools in the UI and in pipelines. See the [Plugins](/plugins/overview) section to build one.

### AI Models
AI Models are signed local Runtime Boxes that Liatir installs and manages for you. The current AI Tool uses Geneformer, scGPT, or UCE for single-cell embeddings.

## Core concepts

| Concept | Description |
|---------|-------------|
| **Data library** | A registry of file paths on disk. Files are never copied — Liatir tracks references and detects when files move or disappear. |
| **Native tool** | A system binary wrapped with a Liatir UI, dependency check, and run history. |
| **Plugin** | A self-contained `.lia` extension that adds custom analysis steps. |
| **AI Model** | A signed Runtime Box model installed locally only when needed. |
| **Pipeline** | A visual workflow where the output of one step feeds the input of the next. |
| **Analysis run** | A single execution: recorded inputs, stdout, parsed sections, and any output files. |

## Getting started

1. [Install Liatir Beta](/getting-started/install) and check the current platform status.
2. [Run your first single-cell analysis](/getting-started/first-analysis).
3. [Add files to your Data library](/data/overview) — import by path, no copying.
4. [Run a native tool](/tools/overview) — start with FastQC or fastp on FASTQ files.
5. [Read the AI guide](/ai/guide) — learn what AI Models and AI Tools do before interpreting results.
6. [Build or import a .lia plugin](/plugins/overview) — for custom logic or pipeline orchestration.
7. [Connect steps in a pipeline](/pipeline/overview) — outputs flow into the next step automatically.


## The name Liatir

Wondering what "Liatir" means? [Here's the story](/introduction/the-name).
